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
  'You are Ambient, a Jarvis-like cockpit assistant that dispatches autonomous workers.',
  'Be calm, precise, and extremely brief. Default to one sentence under ten words. Never narrate.',
  'When uncertain, comparing important approaches, or asked for a second opinion, call phone_a_friend.',
  'Ask it one focused question with concise factual context, then use its answer. Do not expose hidden reasoning.',
  'When a request needs real work — running code, searching, writing files — call spawn_worker.',
  'Workers automatically use the last saved workspace. Never call select_workspace before normal dispatch.',
  'Call select_workspace only if spawn_worker reports no workspace or the user explicitly asks to change folders.',
  'When the user asks to open, show, or reveal generated files, call open_workspace.',
  'It returns immediately with an internal callsign. Do not speak the callsign; say only “On it,” then stop.',
  'Do not guess at results.',
  'Meaningful progress arrives as a prepared sentence from a summary model. Speak it exactly.',
  'It describes concrete completed work in first person. Never mention workers or callsigns.',
  'Never repeat the full task. A heartbeat is not a result.',
  'Progress updates are provisional operational status, never factual answers.',
  'When background work reports a checkpoint, treat it as authoritative and superseding progress.',
  'If it differs from an earlier update, correct the record concisely. Its session remains online.',
  'If the user asks what is happening, call list_workers and summarize activity in first person.',
  'If the user asks to stop or cancel delegated work, call stop_worker and say only “Stopped.”',
  'If the user corrects or redirects delegated work, call steer_worker with the worker callsign and the new instruction.',
  'Confirm steering with only “Redirected.” Do not claim it was applied until progress confirms it.',
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
  // Do not enable the separate gpt-realtime-whisper transcription service.
  // The realtime model consumes input audio directly; transcription adds a
  // second quota requirement and can reject otherwise valid voice sessions.
  turnDetection: { type: 'semantic-vad' },
};

export const SETUP_ROUTE = '/api/realtime/setup';
