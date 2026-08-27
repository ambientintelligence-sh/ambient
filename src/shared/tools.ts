import { tool } from 'ai';
import { z } from 'zod';

/**
 * Tools exposed to the realtime session. Both are client-driven — the model's
 * call arrives over the socket and is handled in `onToolCall`.
 */
export const REALTIME_TOOLS = {
  spawn_worker: tool({
    description: [
      'Dispatch an autonomous Pi worker to run code, edit files, search with Exa, or automate Chrome through DevTools. For factual lookups instruct it to use Exa first; for configuration or interaction instruct it to use Chrome and perform the action.',
      'This returns IMMEDIATELY with a worker name and a status — it does NOT wait for the',
      'work to finish. Call this tool without a spoken preamble. After it returns, say only “I’m [short concrete present-progressive action].” Never say “I’m thinking,” “On it,” or the internal worker name.',
      'You will be told separately when the worker reports back; only then can you describe results.',
      'Never invent a result before the report arrives.',
    ].join(' '),
    inputSchema: z.object({
      task: z
        .string()
        .describe(
          'A complete, self-contained instruction. The worker shares the selected workspace but ' +
            'has no memory of this conversation, so restate everything it needs. For browser tasks, ' +
            'explicitly state the site, desired interactions, and expected result.',
        ),
    }),
  }),
  phone_a_friend: tool({
    description: [
      'Ask the configured expert advisor model a focused question and receive a fast, high-quality answer.',
      'Use when uncertain, when comparing approaches, or when the user explicitly asks for a second opinion.',
      'Send a concrete question and only the context needed to answer it; do not send hidden chain-of-thought.',
    ].join(' '),
    inputSchema: z.object({
      question: z.string().describe('The focused question for the expert advisor.'),
      context: z.string().optional().describe('Concise facts, constraints, or options relevant to the question.'),
    }),
  }),
  select_workspace: tool({
    description:
      'Open the native folder picker to change the shared workspace. Never call before normal dispatch: Ambient reuses the saved folder automatically. Use only when no workspace exists or the user explicitly asks to change it.',
    inputSchema: z.object({}),
  }),
  open_workspace: tool({
    description:
      'Reveal the selected worker workspace on the user’s computer. Use when the user asks to open, show, or reveal generated files.',
    inputSchema: z.object({}),
  }),
  stop_worker: tool({
    description:
      'Immediately stop a queued, running, or online worker. Use when the user asks to stop, cancel, or kill delegated work.',
    inputSchema: z.object({
      worker: z.string().describe('The internal worker callsign, for example KESTREL.'),
    }),
  }),
  steer_worker: tool({
    description: [
      'Send a new instruction to a running or online worker, preserving its Pi session context.',
      'Use this when the user corrects, redirects, or adds requirements to previously delegated work.',
      'Steering is cooperative: a currently running shell command may finish before the instruction is applied.',
    ].join(' '),
    inputSchema: z.object({
      worker: z.string().describe('The worker callsign, for example KESTREL.'),
      instruction: z.string().describe('A complete, explicit correction or new instruction for that worker.'),
    }),
  }),
  list_workers: tool({
    description:
      'List every worker dispatched this session with its task, status, current activity, and final result if available. ' +
      'Use this whenever the user asks what agents are doing or whether work is still in progress.',
    inputSchema: z.object({}),
  }),
};
