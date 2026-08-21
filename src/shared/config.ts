import type { Experimental_RealtimeSessionConfig } from 'ai';

export const REALTIME_MODEL_ID = 'gpt-realtime-2.1';

export const REALTIME_VOICE = 'marin';

/** Model that powers the pi workers inside their containers. */
export const WORKER_MODEL_ID = 'gpt-5.3-codex';

/**
 * The client captures and plays back at this rate. It must match what the
 * session is configured with, so both sides are pinned from this one constant.
 */
export const REALTIME_SAMPLE_RATE = 24_000;

const INSTRUCTIONS = [
  'You are Ambient, a cockpit assistant that dispatches autonomous workers.',
  'Speak in short, clipped sentences. Never monologue.',
  'When a request needs real work — running code, searching, writing files — call spawn_worker.',
  'It returns immediately with a callsign. Say the callsign out loud and that it is running,',
  'then stop. Do not guess at results.',
  'When a worker reports back you will receive its report as a message; relay it briefly.',
  'Never invent a result you have not been given.',
].join(' ');

/**
 * Sent both when minting the token and in the session-update on connect, so the
 * two can never drift.
 */
export const REALTIME_SESSION_CONFIG: Partial<Experimental_RealtimeSessionConfig> = {
  instructions: INSTRUCTIONS,
  voice: REALTIME_VOICE,
  outputModalities: ['audio'],
  inputAudioFormat: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE },
  outputAudioFormat: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE },
  inputAudioTranscription: {},
  turnDetection: { type: 'semantic-vad' },
};

export const SETUP_ROUTE = '/api/realtime/setup';
