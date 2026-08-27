import { tool } from 'ai';
import { z } from 'zod';

/**
 * Tools exposed to the realtime session. Both are client-driven — the model's
 * call arrives over the socket and is handled in `onToolCall`.
 */
export const REALTIME_TOOLS = {
  spawn_worker: tool({
    description: [
      'Dispatch an autonomous worker to carry out a task in its own sandboxed container.',
      'This returns IMMEDIATELY with a worker name and a status — it does NOT wait for the',
      'work to finish. Say only “On it.” Do not speak the internal worker name.',
      'You will be told separately when the worker reports back; only then can you describe results.',
      'Never invent a result before the report arrives.',
    ].join(' '),
    inputSchema: z.object({
      task: z
        .string()
        .describe(
          'A complete, self-contained instruction. The worker starts in an empty directory ' +
            'with no memory of this conversation, so restate everything it needs.',
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
      'Open the native folder picker so the user can choose the host folder shared read/write with all workers.',
    inputSchema: z.object({}),
  }),
  open_workspace: tool({
    description:
      'Reveal the selected worker workspace on the user’s computer. Use when the user asks to open, show, or reveal generated files.',
    inputSchema: z.object({}),
  }),
  stop_worker: tool({
    description:
      'Immediately stop a queued or running worker. Use when the user asks to stop, cancel, or kill delegated work.',
    inputSchema: z.object({
      worker: z.string().describe('The internal worker callsign, for example KESTREL.'),
    }),
  }),
  steer_worker: tool({
    description: [
      'Send a new instruction to a running worker so it changes direction at the next safe point.',
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
