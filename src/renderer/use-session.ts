import { useCallback, useEffect, useRef, useState } from 'react';
import { openai } from '@ai-sdk/openai';
import { experimental_useRealtime } from '@ai-sdk/react';
import { REALTIME_MODEL_ID, REALTIME_SAMPLE_RATE, REALTIME_SESSION_CONFIG } from '@/shared/config';
import type { Worker } from '@/shared/worker';

const TRACE_LENGTH = 72;
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

const reportText = (worker: Worker) =>
  worker.status === 'done'
    ? `Worker ${worker.name} has finished. Its report: ${worker.summary ?? '(no summary)'}`
    : `Worker ${worker.name} failed. Reason: ${worker.error ?? 'unknown'}`;

export function useSession(): SessionView {
  const [workers, setWorkers] = useState<readonly Worker[]>([]);
  const [inTrace, setInTrace] = useState<readonly number[]>(emptyTrace);
  const [outTrace, setOutTrace] = useState<readonly number[]>(emptyTrace);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState(0);
  const [lastReport, setLastReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  /** Reports that arrived while the model was mid-response. */
  const queuedReports = useRef<Worker[]>([]);
  const responseActive = useRef(false);
  /** Lets the mount-once subscriptions reach current state without re-binding. */
  const announceRef = useRef<(worker: Worker) => void>(() => {});
  const connectedRef = useRef(false);

  const realtime = experimental_useRealtime({
    model: openai.experimental_realtime(REALTIME_MODEL_ID),
    api: { token: bridge?.setupUrl ?? '' },
    sessionConfig: REALTIME_SESSION_CONFIG,
    sampleRate: REALTIME_SAMPLE_RATE,
    onError: (err) => setError(err.message),
    onToolCall: async ({ toolCall }) => {
      if (!bridge) return { error: 'worker bridge unavailable' };

      if (toolCall.toolName === 'spawn_worker') {
        const { task } = toolCall.args as { task?: string };
        if (!task) return { error: 'task is required' };
        const worker = await bridge.dispatchWorker(task);
        return {
          worker: worker.name,
          status: 'dispatched',
          note: 'Running in the background. Do not describe results until its report arrives.',
        };
      }

      if (toolCall.toolName === 'list_workers') {
        const list = await bridge.listWorkers();
        return {
          workers: list.map((worker) => ({
            name: worker.name,
            status: worker.status,
            lastStep: worker.stops.at(-1)?.tool ?? null,
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
        case 'response-done': {
          responseActive.current = false;
          // Drain anything that landed while the model was talking.
          const queued = queuedReports.current.shift();
          if (queued && connectedRef.current) announceRef.current(queued);
          break;
        }
      }
    },
  });

  const sendEvent = realtime.sendEvent;
  const connected = realtime.status === 'connected';

  /**
   * A worker finishes long after its tool call returned, so the report is pushed
   * into the conversation as a new item and a response is requested for it.
   */
  const announce = useCallback(
    (worker: Worker) => {
      sendEvent({
        type: 'conversation-item-create',
        item: { type: 'text-message', role: 'user', text: reportText(worker) },
      });
      sendEvent({
        type: 'response-create',
        options: {
          instructions:
            'A worker just reported back. Relay it to the user in one or two short sentences. ' +
            'Do not read it verbatim.',
        },
      });
      responseActive.current = true;
    },
    [sendEvent],
  );

  useEffect(() => {
    announceRef.current = announce;
    connectedRef.current = connected;
  });

  // Bound once: worker events arrive for the life of the window.
  useEffect(() => {
    if (!bridge) return;
    return bridge.onWorkerEvent((event) => {
      setWorkers((current) => upsert(current, event.worker));
      if (event.kind !== 'report') return;

      setLastReport(
        event.worker.status === 'done'
          ? `${event.worker.name} — ${event.worker.summary ?? 'done'}`
          : `${event.worker.name} — FAILED: ${event.worker.error ?? 'unknown'}`,
      );

      if (!connectedRef.current) return;
      if (responseActive.current) queuedReports.current.push(event.worker);
      else announceRef.current(event.worker);
    });
  }, []);

  const connect = useCallback(() => {
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
      setError(err instanceof Error ? err.message : 'microphone unavailable');
    });
  }, [realtime]);

  const disconnect = useCallback(() => {
    realtime.stopAudioCapture();
    realtime.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setListening(false);
    setInTrace(emptyTrace());
    setOutTrace(emptyTrace());
  }, [realtime]);

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
    status: realtime.status,
    workers,
    inTrace,
    outTrace,
    listening,
    speaking: realtime.isPlaying,
    muted,
    turns,
    lastReport,
    error,
    connect,
    disconnect,
    toggleMute,
  };
}
