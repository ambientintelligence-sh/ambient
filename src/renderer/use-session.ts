import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { openai } from '@ai-sdk/openai';
import { experimental_useRealtime } from '@ai-sdk/react';
import { REALTIME_INSTRUCTIONS, REALTIME_MODEL_ID, REALTIME_VOICE } from '@/shared/config';
import { INITIAL_FLEET, reduceFleet, type FleetState } from './fleet';

const TRACE_LENGTH = 72;
const emptyTrace = () => new Array<number>(TRACE_LENGTH).fill(0);

/** Empty outside Electron (browser preview of the panel). */
const setupUrl = window.ambient?.setupUrl ?? '';

export type SessionView = {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  fleet: FleetState;
  /** Rolling 0..1 mic energy, oldest first. */
  inTrace: readonly number[];
  /** Rolling 0..1 model speech energy, oldest first. */
  outTrace: readonly number[];
  listening: boolean;
  speaking: boolean;
  muted: boolean;
  turns: number;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  toggleMute: () => void;
};

export function useSession(): SessionView {
  const [fleet, dispatch] = useReducer(reduceFleet, INITIAL_FLEET);
  const [inTrace, setInTrace] = useState<readonly number[]>(emptyTrace);
  const [outTrace, setOutTrace] = useState<readonly number[]>(emptyTrace);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const realtime = experimental_useRealtime({
    model: openai.experimental_realtime(REALTIME_MODEL_ID),
    api: { token: setupUrl },
    sessionConfig: {
      instructions: REALTIME_INSTRUCTIONS,
      voice: REALTIME_VOICE,
      outputModalities: ['audio'],
      inputAudioTranscription: { model: 'whisper-1' },
      turnDetection: { type: 'semantic-vad' },
    },
    onError: (err) => setError(err.message),
    onEvent: (event) => {
      switch (event.type) {
        case 'speech-started':
          setListening(true);
          break;
        case 'speech-stopped':
          setListening(false);
          break;
        case 'response-created':
          setTurns((count) => count + 1);
          dispatch({ kind: 'delegate', roll: Math.random() });
          break;
        case 'audio-transcript-delta':
          dispatch({ kind: 'advance', roll: Math.random() });
          break;
        case 'response-done':
          dispatch({ kind: 'settle' });
          break;
      }
    },
  });

  const speaking = realtime.isPlaying;

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
      const probe = await fetch(setupUrl, {
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
    dispatch({ kind: 'reset' });
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
    fleet,
    inTrace,
    outTrace,
    listening,
    speaking,
    muted,
    turns,
    error,
    connect,
    disconnect,
    toggleMute,
  };
}
