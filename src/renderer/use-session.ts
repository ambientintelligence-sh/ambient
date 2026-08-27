import { useCallback, useEffect, useRef, useState } from 'react';
import { openai } from '@ai-sdk/openai';
import { experimental_useRealtime } from '@ai-sdk/react';
import { REALTIME_MODEL_ID, REALTIME_SAMPLE_RATE, REALTIME_SESSION_CONFIG } from '@/shared/config';
import type { Worker } from '@/shared/worker';

const TRACE_LENGTH = 72;
const emptyTrace = () => new Array<number>(TRACE_LENGTH).fill(0);

const bridge = window.ambient;
// The realtime hook keys its internal store by model object identity. Creating
// this inside the React render function would replace the connected store on
// every state update, making an active session appear disconnected.
const REALTIME_MODEL = openai.experimental_realtime(REALTIME_MODEL_ID);

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

const upsert = (workers: readonly Worker[], next: Worker): readonly Worker[] => {
  const index = workers.findIndex((worker) => worker.name === next.name);
  if (index === -1) return [...workers, next];
  return workers.map((worker) => (worker.name === next.name ? next : worker));
};

type Announcement = Readonly<{ kind: 'progress' | 'report'; worker: Worker; summary?: string }>;

const announcementText = ({ kind, worker, summary }: Announcement) => {
  if (kind === 'progress') {
    return `Prepared progress update: ${summary ?? 'SKIP'}. This is not a final result.`;
  }
  if (worker.status === 'cancelled') return 'Background work was stopped by the user.';
  return worker.status === 'idle'
    ? `Background work reached a checkpoint and remains online. Report: ${worker.summary ?? '(no summary)'}`
    : `Background work failed. Reason: ${worker.error ?? 'unknown'}`;
};

export function useSession(): SessionView {
  const [workers, setWorkers] = useState<readonly Worker[]>([]);
  const [inTrace, setInTrace] = useState<readonly number[]>(emptyTrace);
  const [outTrace, setOutTrace] = useState<readonly number[]>(emptyTrace);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [turns, setTurns] = useState(0);
  const [lastReport, setLastReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const releaseMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setListening(false);
    setInTrace(emptyTrace());
    setOutTrace(emptyTrace());
  }, []);

  /** Announcements that arrived while the model was mid-response. */
  const queuedAnnouncements = useRef<Announcement[]>([]);
  const responseActive = useRef(false);
  const playingRef = useRef(false);
  const drainAnnouncementsRef = useRef<() => void>(() => {});
  const lastProgressDeliveredAt = useRef(0);
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deliverAnnouncementRef = useRef<(announcement: Announcement) => void>(() => {});
  const pendingResponseRetry = useRef(false);
  const lastResponseInstructions = useRef('');
  const retryResponseRef = useRef<() => void>(() => {});
  /** Lets the mount-once subscriptions reach current state without re-binding. */
  const connectedRef = useRef(false);
  const connectingRef = useRef(false);

  const realtime = experimental_useRealtime({
    model: REALTIME_MODEL,
    api: { token: bridge?.setupUrl ?? '' },
    sessionConfig: REALTIME_SESSION_CONFIG,
    sampleRate: REALTIME_SAMPLE_RATE,
    onError: (err) => {
      if (err.message.includes('already shorter than')) {
        // Recoverable OpenAI truncate rejection from an interrupted audio item.
        // Keep the realtime session and microphone alive.
        return;
      }
      if (err.message.includes('active response in progress')) {
        // A VAD/user response won the race with a background announcement.
        // Keep the conversation item and retry response-create when that turn ends.
        pendingResponseRetry.current = true;
        responseActive.current = true;
        return;
      }
      releaseMedia();
      setError(err.message);
    },
    onToolCall: async ({ toolCall }) => {
      if (!bridge) return { error: 'worker bridge unavailable' };

      if (toolCall.toolName === 'phone_a_friend') {
        const { question, context } = toolCall.args as { question?: string; context?: string };
        if (!question?.trim()) return { error: 'A focused question is required' };
        try {
          const answer = await bridge.askAdvisor(question.trim(), context?.trim());
          return { answer, instruction: 'Use this advice to answer the user concisely.' };
        } catch (cause) {
          return { error: cause instanceof Error ? cause.message : String(cause) };
        }
      }

      if (toolCall.toolName === 'select_workspace') {
        const workspace = await bridge.selectWorkspace();
        return workspace.path
          ? { status: 'selected', name: workspace.name, path: workspace.path }
          : { status: 'cancelled', note: 'No workspace was selected.' };
      }

      if (toolCall.toolName === 'open_workspace') {
        try {
          const workspace = await bridge.openWorkspace();
          return { status: 'opened', name: workspace.name, path: workspace.path };
        } catch (cause) {
          return { error: cause instanceof Error ? cause.message : String(cause) };
        }
      }

      if (toolCall.toolName === 'spawn_worker') {
        const { task } = toolCall.args as { task?: string };
        if (!task) return { error: 'task is required' };
        const workspace = await bridge.getWorkspace();
        if (!workspace.path) {
          return { error: 'No workspace selected. Call select_workspace, then retry the dispatch.' };
        }
        const worker = await bridge.dispatchWorker(task);
        return {
          worker: worker.name,
          status: 'dispatched',
          note:
            'Acknowledge once with “I’m [short concrete present-progressive action].” ' +
            'Do not say “I’m thinking,” “On it,” or the worker name. Do not describe results yet.',
        };
      }

      if (toolCall.toolName === 'stop_worker') {
        const { worker } = toolCall.args as { worker?: string };
        if (!worker) return { error: 'worker is required' };
        const result = await bridge.stopWorker(worker);
        return result.ok ? result : { error: result.error };
      }

      if (toolCall.toolName === 'steer_worker') {
        const { worker, instruction } = toolCall.args as { worker?: string; instruction?: string };
        if (!worker || !instruction) return { error: 'worker and instruction are required' };
        const result = await bridge.steerWorker(worker, instruction);
        return result.ok
          ? {
              worker: result.worker,
              status: result.status,
              note: 'The instruction will be applied at the next safe point. Do not claim it has already changed direction.',
            }
          : { error: result.error };
      }

      if (toolCall.toolName === 'list_workers') {
        const list = await bridge.listWorkers();
        return {
          workers: list.map((worker) => ({
            name: worker.name,
            task: worker.task,
            status: worker.status,
            currentActivity: worker.stops.at(-1) ?? null,
            summary: worker.status === 'idle' ? worker.summary : null,
            error: worker.status === 'failed' ? worker.error : null,
          })),
        };
      }

      return undefined;
    },
    onEvent: (event) => {
      switch (event.type) {
        case 'speech-started':
          setListening(true);
          break;
        case 'speech-stopped':
          setListening(false);
          break;
        case 'response-created':
          responseActive.current = true;
          setTurns((count) => count + 1);
          break;
        case 'response-done':
          responseActive.current = false;
          // Generation can finish several seconds before queued audio playback.
          // Wait for playback to end so offsets never span two response items.
          drainAnnouncementsRef.current();
          break;
      }
    },
  });

  const sendEvent = realtime.sendEvent;
  const connected = realtime.status === 'connected';
  const transcriptMessage = [...realtime.messages]
    .reverse()
    .find((message) =>
      message.role === 'assistant' &&
      message.parts.some((part) => part.type === 'text' && part.text.trim()),
    );
  const transcript = transcriptMessage?.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .trim() ?? '';

  const requestAnnouncementResponse = useCallback(
    (instructions: string) => {
      lastResponseInstructions.current = instructions;
      sendEvent({ type: 'response-create', options: { instructions } });
      responseActive.current = true;
    },
    [sendEvent],
  );

  /**
   * A worker finishes long after its tool call returned, so the report is pushed
   * into the conversation as a new item and a response is requested for it.
   */
  const announce = useCallback(
    (announcement: Announcement) => {
      sendEvent({
        type: 'conversation-item-create',
        item: { type: 'text-message', role: 'user', text: announcementText(announcement) },
      });
      requestAnnouncementResponse(
        announcement.kind === 'progress'
          ? `Say exactly this prepared update, with no additions: ${announcement.summary ?? ''}`
          : 'This checkpoint is authoritative and supersedes provisional progress. Relay it concisely; correct any earlier conflict. Never mention workers or callsigns.',
      );
    },
    [sendEvent, requestAnnouncementResponse],
  );

  const enqueueAnnouncement = useCallback((announcement: Announcement) => {
    queuedAnnouncements.current = queuedAnnouncements.current.filter(
      (queued) =>
        queued.worker.name !== announcement.worker.name ||
        (queued.kind === 'report' && announcement.kind === 'progress'),
    );
    if (announcement.kind === 'report') queuedAnnouncements.current.unshift(announcement);
    else if (!queuedAnnouncements.current.some((queued) => queued.worker.name === announcement.worker.name)) {
      queuedAnnouncements.current.push(announcement);
    }
  }, []);

  const deliverAnnouncement = useCallback((announcement: Announcement) => {
    if (responseActive.current || playingRef.current) {
      enqueueAnnouncement(announcement);
      return;
    }
    if (announcement.kind === 'progress') {
      const delay = Math.max(0, 5_000 - (Date.now() - lastProgressDeliveredAt.current));
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
    announce(announcement);
  }, [announce, enqueueAnnouncement]);

  const drainAnnouncements = useCallback(() => {
    if (responseActive.current || playingRef.current || !connectedRef.current) return;
    if (pendingResponseRetry.current) {
      pendingResponseRetry.current = false;
      retryResponseRef.current();
      return;
    }
    const queued = queuedAnnouncements.current.shift();
    if (queued) deliverAnnouncementRef.current(queued);
  }, []);

  useEffect(() => {
    deliverAnnouncementRef.current = deliverAnnouncement;
    drainAnnouncementsRef.current = drainAnnouncements;
    connectedRef.current = connected;
    playingRef.current = realtime.isPlaying;
    retryResponseRef.current = () => requestAnnouncementResponse(lastResponseInstructions.current);
    if (!realtime.isPlaying) drainAnnouncements();
  });

  useEffect(() => () => {
    if (announcementTimer.current) clearTimeout(announcementTimer.current);
  }, []);

  // Bound once: worker events arrive for the life of the window.
  useEffect(() => {
    if (!bridge) return;
    return bridge.onWorkerEvent((event) => {
      setWorkers((current) => upsert(current, event.worker));
      if (event.kind === 'update') return;

      setLastReport(
        event.kind === 'progress'
          ? `${event.worker.name} — ${event.summary}`
          : event.worker.status === 'idle'
            ? `${event.worker.name} — ONLINE: ${event.worker.summary ?? 'checkpoint reached'}`
            : event.worker.status === 'cancelled'
              ? `${event.worker.name} — STOPPED`
              : `${event.worker.name} — FAILED: ${event.worker.error ?? 'unknown'}`,
      );

      if (!connectedRef.current) return;
      const announcement: Announcement = {
        kind: event.kind,
        worker: event.worker,
        ...(event.kind === 'progress' ? { summary: event.summary } : {}),
      };
      deliverAnnouncementRef.current(announcement);
    });
  }, []);

  const connect = useCallback(() => {
    // React state and the realtime hook do not update synchronously. This ref
    // closes the brief window in which a second click could open another session.
    if (
      connectingRef.current ||
      connectedRef.current ||
      realtime.status === 'connecting' ||
      realtime.status === 'connected'
    ) return;
    connectingRef.current = true;
    setStarting(true);
    setError(null);
    void (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      // connect() reports a bare status code, so probe the endpoint first to
      // surface the real reason (missing key, bad key) on the panel.
      const probe = await fetch(bridge?.setupUrl ?? '', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionConfig: {} }),
      });
      if (!probe.ok) {
        const body = (await probe.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `setup endpoint failed (${probe.status})`);
      }

      await realtime.connect();
      realtime.startAudioCapture(stream);
    })().catch((err: unknown) => {
      // A setup/connect failure can happen after getUserMedia succeeds. Release
      // it here so the mic trace and privacy indicator do not keep running
      // while the session is visibly offline.
      realtime.stopAudioCapture();
      realtime.disconnect();
      releaseMedia();
      setError(err instanceof Error ? err.message : 'microphone unavailable');
    }).finally(() => {
      connectingRef.current = false;
      setStarting(false);
    });
  }, [realtime, releaseMedia]);

  const disconnect = useCallback(() => {
    connectingRef.current = false;
    pendingResponseRetry.current = false;
    queuedAnnouncements.current = [];
    if (announcementTimer.current) clearTimeout(announcementTimer.current);
    announcementTimer.current = null;
    setStarting(false);
    realtime.stopAudioCapture();
    realtime.disconnect();
    releaseMedia();
  }, [realtime, releaseMedia]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
  }, [muted]);

  // Both traces are sampled at 20 Hz — a 72-point trace spans ~3.6s, and
  // sampling per animation frame would re-render the whole HUD for no gain.
  useEffect(() => {
    const bins = new Uint8Array(256);

    const sample = () => {
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
        const target = realtime.isPlaying ? 0.45 + Math.random() * 0.5 : 0;
        const last = trace[trace.length - 1] ?? 0;
        return [...trace.slice(1), last + (target - last) * 0.4];
      });
    };

    const timer = setInterval(sample, 50);
    return () => clearInterval(timer);
  }, [realtime.isPlaying]);

  return {
    status: starting && realtime.status !== 'connected' ? 'connecting' : realtime.status,
    workers,
    inTrace,
    outTrace,
    listening,
    speaking: realtime.isPlaying,
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
