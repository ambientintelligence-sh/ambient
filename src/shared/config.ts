import type { Experimental_RealtimeSessionConfig } from 'ai';

export const REALTIME_MODEL_ID = 'gpt-realtime-2.1';

export const REALTIME_VOICE = 'marin';

/**
 * The client captures and plays back at this rate. It must match what the
 * session is configured with, so both sides are pinned from this one constant.
 */
export const REALTIME_SAMPLE_RATE = 24_000;

const INSTRUCTIONS = [
  'You are Ambient, the orchestrator of a small fleet of specialist agents.',
  'Speak in short, clipped sentences — you are a cockpit assistant, not a chatbot.',
  'When a request needs specialist work, say out loud which agent you are delegating to',
  'and why, in one sentence. Never invent results you do not have.',
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
