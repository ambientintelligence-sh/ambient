import { useCallback, useEffect, useRef, useState } from 'react';
import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
  tool,
  type RealtimeItem,
} from '@openai/agents/realtime';
import { z } from 'zod';
import {
  REALTIME_INSTRUCTIONS,
  REALTIME_MODEL_ID,
  REALTIME_VOICE,
} from '@/shared/config';
import type { Worker } from '@/shared/worker';

const TRACE_LENGTH = 72;
const PROGRESS_GAP_MS = 12_000;
const emptyTrace = () => new Array<number>(TRACE_LENGTH).fill(0);
const bridge = window.ambient;

export type SessionView = {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  workers: readonly Worker[];
  inTrace: readonly number[];
  outTrace: readonly number[];
  listening: boolean;
  speaking: boolean;
  muted: boolean;
  turns: number;
  lastReport: string | null;
  transcript: string;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  toggleMute: () => void;
};

type Announcement =
  | Readonly<{ kind: 'progress'; summary: string }>
  | Readonly<{ kind: 'report'; worker: Worker }>;

const upsert = (workers: readonly Worker[], next: Worker): readonly Worker[] => {
  const index = workers.findIndex((worker) => worker.name === next.name);
  if (index === -1) return [...workers, next];
  return workers.map((worker) => (worker.name === next.name ? next : worker));
};

const announcementInstruction = (announcement: Announcement) => {
  if (announcement.kind === 'progress') {
    return `Speak exactly this progress update and nothing else: “${announcement.summary}”`;
  }
  const { worker } = announcement;
  if (worker.status === 'cancelled') return 'Tell the user exactly: “Stopped.”';
  if (worker.status === 'idle') {
    const visualContext = worker.display
      ? ` A dashboard widget titled “${worker.display.title}” is now visible. Tell the user it is on screen and speak only the key takeaway; do not read the whole widget aloud.`
      : '';
    return `The requested background work finished.${visualContext} Give the user its definitive result naturally and concisely. Do not call it an update, checkpoint, or provisional result. Result: ${worker.summary ?? '(no summary)'}`;
  }
  return `Tell the user briefly that the task failed and give this reason: ${worker.error ?? 'unknown'}`;
};

const stringify = (value: unknown) => JSON.stringify(value);

function createVoiceTools() {
  if (!bridge) return [];
  return [
    tool({
      name: 'phone_a_friend',
      description:
        'Get an independent second opinion. Before calling, tell the user “I’m getting a second opinion.” Use for tradeoffs, difficult judgment, unfamiliar domains, ambiguous requests, and before a possibly unnecessary refusal. Ask broadly, share rich relevant context, and invite overlooked concerns or better approaches.',
      parameters: z.object({
        question: z.string().describe('Broad question about what to do, decide, check, or reconsider.'),
        context: z.string().optional().describe('Relevant conversation, task history, constraints, attempted approach, and available evidence.'),
      }),
      execute: async ({ question, context }) => {
        const answer = await bridge.askAdvisor(question.trim(), context?.trim());
        return stringify({
          answer,
          instruction: 'Evaluate this independent advice against the user’s intent and your full context, then use the helpful parts. If it requests missing evidence, investigate rather than guess.',
        });
      },
    }),
    tool({
      name: 'select_workspace',
      description:
        'Open the folder picker to change the shared workspace. Never call before normal dispatch; reuse the saved workspace unless none exists or the user asks to change it.',
      parameters: z.object({}),
      execute: async () => {
        const workspace = await bridge.selectWorkspace();
        return stringify(workspace.path
          ? { status: 'selected', name: workspace.name, path: workspace.path }
          : { status: 'cancelled' });
      },
    }),
    tool({
      name: 'open_workspace',
      description: 'Reveal the selected workspace when the user asks to open or show generated files.',
      parameters: z.object({}),
      execute: async () => stringify(await bridge.openWorkspace()),
    }),
    tool({
      name: 'spawn_worker',
      description:
        'Dispatch a Pi worker for code, files, search, or browser automation. Workers have a show_widget tool for HTML widgets inside Ambient. If the user says “widget” or asks to put something on the dashboard, explicitly tell the worker to call show_widget. Also request it when structured visual results would be clearer on screen. Always use Exa first for factual lookups; only use the browser when Exa is insufficient or interaction is required. Returns immediately.',
      parameters: z.object({
        task: z.string().describe('Complete self-contained task with all relevant context and expected result. If the user requested a widget, explicitly require the show_widget tool.'),
      }),
      execute: async ({ task }) => {
        const workspace = await bridge.getWorkspace();
        if (!workspace.path) {
          return stringify({ error: 'No workspace selected. Call select_workspace, then retry.' });
        }
        const worker = await bridge.dispatchWorker(task);
        return stringify({
          worker: worker.name,
          status: 'dispatched',
          instruction:
            'Say only “I’m [short concrete present-progressive action].” Never say “I’m thinking,” “On it,” or the worker name.',
        });
      },
    }),
    tool({
      name: 'stop_worker',
      description: 'Immediately stop a queued, running, or online worker when the user asks to stop or cancel it.',
      parameters: z.object({ worker: z.string() }),
      execute: async ({ worker }) => stringify(await bridge.stopWorker(worker)),
    }),
    tool({
      name: 'steer_worker',
      description: 'Redirect a running or online worker while preserving its Pi session context.',
      parameters: z.object({ worker: z.string(), instruction: z.string() }),
      execute: async ({ worker, instruction }) => stringify(await bridge.steerWorker(worker, instruction)),
    }),
    tool({
      name: 'list_workers',
      description: 'Return every worker’s task, status, current activity, checkpoint, and error.',
      parameters: z.object({}),
      execute: async () => {
        const workers = (await bridge.listWorkers()).map((worker) => ({
          name: worker.name,
          task: worker.task,
          status: worker.status,
          currentActivity: worker.stops.at(-1) ?? null,
          summary: worker.status === 'idle' ? worker.summary : null,
          error: worker.status === 'failed' ? worker.error : null,
        }));
        return stringify({ workers });
      },
    }),
  ];
}

function transcriptFromHistory(history: RealtimeItem[]): string {
  const message = [...history].reverse().find((item) => item.type === 'message' && item.role === 'assistant');
  if (!message || message.type !== 'message' || message.role !== 'assistant') return '';
  return message.content
    .map((part) => part.type === 'output_audio' ? part.transcript ?? '' : part.type === 'output_text' ? part.text : '')
    .join(' ')
    .trim();
}

export function useSession(): SessionView {
  const [status, setStatus] = useState<SessionView['status']>('disconnected');
  const [workers, setWorkers] = useState<readonly Worker[]>([]);
  const [inTrace, setInTrace] = useState<readonly number[]>(emptyTrace);
  const [outTrace, setOutTrace] = useState<readonly number[]>(emptyTrace);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState(0);
  const [lastReport, setLastReport] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const realtimeRef = useRef<RealtimeSession | null>(null);
  const transportRef = useRef<OpenAIRealtimeWebRTC | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const connectingRef = useRef(false);
  const connectedRef = useRef(false);
  const responseActiveRef = useRef(false);
  const listeningRef = useRef(false);
  const speakingRef = useRef(false);

  const queuedAnnouncements = useRef<Announcement[]>([]);
  const lastProgressDeliveredAt = useRef(0);
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deliverAnnouncementRef = useRef<(announcement: Announcement) => void>(() => {});
  const drainAnnouncementsRef = useRef<() => void>(() => {});

  const releaseMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    listeningRef.current = false;
    speakingRef.current = false;
    setListening(false);
    setSpeaking(false);
    setInTrace(emptyTrace());
    setOutTrace(emptyTrace());
  }, []);

  const enqueueAnnouncement = useCallback((announcement: Announcement) => {
    if (announcement.kind === 'progress') {
      // A newer fleet digest supersedes every older provisional digest.
      queuedAnnouncements.current = queuedAnnouncements.current.filter((queued) => queued.kind !== 'progress');
      queuedAnnouncements.current.push(announcement);
      return;
    }
    queuedAnnouncements.current = queuedAnnouncements.current.filter(
      (queued) => queued.kind !== 'report' || queued.worker.name !== announcement.worker.name,
    );
    queuedAnnouncements.current.unshift(announcement);
  }, []);

  const drainAnnouncements = useCallback(() => {
    if (
      responseActiveRef.current ||
      listeningRef.current ||
      speakingRef.current ||
      !connectedRef.current
    ) return;
    const queued = queuedAnnouncements.current.shift();
    if (queued) deliverAnnouncementRef.current(queued);
  }, []);

  const deliverAnnouncement = useCallback((announcement: Announcement) => {
    const transport = transportRef.current;
    if (!transport || !connectedRef.current) return;
    if (responseActiveRef.current || listeningRef.current || speakingRef.current) {
      enqueueAnnouncement(announcement);
      return;
    }
    if (announcement.kind === 'progress') {
      const delay = Math.max(0, PROGRESS_GAP_MS - (Date.now() - lastProgressDeliveredAt.current));
      if (delay > 0) {
        enqueueAnnouncement(announcement);
        if (!announcementTimer.current) {
          announcementTimer.current = setTimeout(() => {
            announcementTimer.current = null;
            drainAnnouncementsRef.current();
          }, delay);
        }
        return;
      }
      lastProgressDeliveredAt.current = Date.now();
    }
    responseActiveRef.current = true;
    // Use a one-off response instruction rather than sendMessage(). sendMessage
    // creates a user conversation item, which makes internal updates look like
    // things the user said and invites acknowledgements such as “Got it.”
    transport.sendEvent({
      type: 'response.create',
      response: { instructions: announcementInstruction(announcement) },
    });
  }, [enqueueAnnouncement]);

  useEffect(() => {
    deliverAnnouncementRef.current = deliverAnnouncement;
    drainAnnouncementsRef.current = drainAnnouncements;
  });

  useEffect(() => () => {
    if (announcementTimer.current) clearTimeout(announcementTimer.current);
    realtimeRef.current?.close();
    releaseMedia();
  }, [releaseMedia]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onWorkerEvent((event) => {
      if (event.kind === 'fleet-progress') {
        setLastReport(`FLEET — ${event.summary}`);
        if (connectedRef.current) {
          deliverAnnouncementRef.current({ kind: 'progress', summary: event.summary });
        }
        return;
      }

      setWorkers((current) => upsert(current, event.worker));
      if (event.kind === 'update') return;
      setLastReport(
        event.worker.status === 'idle'
          ? `${event.worker.name} — ONLINE: ${event.worker.summary ?? 'checkpoint reached'}`
          : event.worker.status === 'cancelled'
            ? `${event.worker.name} — STOPPED`
            : `${event.worker.name} — FAILED: ${event.worker.error ?? 'unknown'}`,
      );
      if (connectedRef.current) {
        deliverAnnouncementRef.current({ kind: 'report', worker: event.worker });
      }
    });
  }, []);

  const connect = useCallback(() => {
    if (connectingRef.current || connectedRef.current) return;
    connectingRef.current = true;
    setStatus('connecting');
    setError(null);

    void (async () => {
      if (!bridge?.setupUrl) throw new Error('Realtime setup endpoint is unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const meterContext = new AudioContext();
      const analyser = meterContext.createAnalyser();
      analyser.fftSize = 512;
      meterContext.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = meterContext;
      analyserRef.current = analyser;

      const tokenResponse = await fetch(bridge.setupUrl, { method: 'POST' });
      const tokenPayload = await tokenResponse.json() as { token?: string; error?: string };
      if (!tokenResponse.ok || !tokenPayload.token) {
        throw new Error(tokenPayload.error ?? `Realtime setup failed (${tokenResponse.status})`);
      }

      const transport = new OpenAIRealtimeWebRTC({ mediaStream: stream });
      transportRef.current = transport;
      const agent = new RealtimeAgent({
        name: 'Ambient',
        instructions: REALTIME_INSTRUCTIONS,
        voice: REALTIME_VOICE,
        tools: createVoiceTools(),
      });
      const realtime = new RealtimeSession(agent, {
        transport,
        model: REALTIME_MODEL_ID,
        tracingDisabled: true,
        config: {
          outputModalities: ['audio'],
          audio: {
            input: {
              transcription: null,
              noiseReduction: { type: 'near_field' },
              turnDetection: {
                type: 'semantic_vad',
                createResponse: true,
                interruptResponse: true,
                eagerness: 'auto',
              },
            },
            output: { voice: REALTIME_VOICE },
          },
          reasoning: { effort: 'low' },
        },
      });
      realtimeRef.current = realtime;

      transport.on('connection_change', (next) => {
        connectedRef.current = next === 'connected';
        setStatus(next);
        if (next === 'disconnected') {
          responseActiveRef.current = false;
          setListening(false);
          setSpeaking(false);
        }
      });
      realtime.on('agent_start', () => {
        responseActiveRef.current = true;
        setTurns((count) => count + 1);
      });
      realtime.on('agent_end', () => {
        responseActiveRef.current = false;
        drainAnnouncementsRef.current();
      });
      realtime.on('audio_start', () => {
        speakingRef.current = true;
        setSpeaking(true);
      });
      realtime.on('audio_stopped', () => {
        speakingRef.current = false;
        setSpeaking(false);
        drainAnnouncementsRef.current();
      });
      realtime.on('audio_interrupted', () => {
        speakingRef.current = false;
        setSpeaking(false);
      });
      realtime.on('history_updated', (history) => {
        const latest = transcriptFromHistory(history);
        if (latest) setTranscript(latest);
      });
      realtime.on('transport_event', (event) => {
        if (event.type === 'input_audio_buffer.speech_started') {
          listeningRef.current = true;
          speakingRef.current = false;
          setListening(true);
          setSpeaking(false);
        } else if (event.type === 'input_audio_buffer.speech_stopped') {
          listeningRef.current = false;
          setListening(false);
        }
      });
      realtime.on('error', ({ error: cause }) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
      });

      await realtime.connect({ apiKey: tokenPayload.token, model: REALTIME_MODEL_ID });
      connectedRef.current = true;
      setStatus('connected');
    })()
      .catch((cause: unknown) => {
        realtimeRef.current?.close();
        realtimeRef.current = null;
        transportRef.current = null;
        connectedRef.current = false;
        setStatus('error');
        releaseMedia();
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        connectingRef.current = false;
      });
  }, [releaseMedia]);

  const disconnect = useCallback(() => {
    connectingRef.current = false;
    connectedRef.current = false;
    responseActiveRef.current = false;
    queuedAnnouncements.current = [];
    if (announcementTimer.current) clearTimeout(announcementTimer.current);
    announcementTimer.current = null;
    realtimeRef.current?.close();
    realtimeRef.current = null;
    transportRef.current = null;
    releaseMedia();
    setStatus('disconnected');
  }, [releaseMedia]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    realtimeRef.current?.mute(next);
    setMuted(next);
  }, [muted]);

  useEffect(() => {
    const bins = new Uint8Array(256);
    const timer = setInterval(() => {
      const analyser = analyserRef.current;
      let energy = 0;
      if (analyser) {
        analyser.getByteTimeDomainData(bins);
        let sum = 0;
        for (const bin of bins) sum += (bin - 128) ** 2;
        energy = Math.min(1, Math.sqrt(sum / bins.length) / 42);
      }
      setInTrace((trace) => [...trace.slice(1), energy]);
      setOutTrace((trace) => {
        const target = speakingRef.current ? 0.45 + Math.random() * 0.5 : 0;
        const last = trace[trace.length - 1] ?? 0;
        return [...trace.slice(1), last + (target - last) * 0.4];
      });
    }, 50);
    return () => clearInterval(timer);
  }, []);

  return {
    status,
    workers,
    inTrace,
    outTrace,
    listening,
    speaking,
    muted,
    turns,
    lastReport,
    transcript,
    error,
    connect,
    disconnect,
    toggleMute,
  };
}
