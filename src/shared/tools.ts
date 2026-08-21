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
      'work to finish. Tell the user the worker name and that it is running, then carry on.',
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
  list_workers: tool({
    description: 'List every worker dispatched this session with its current status and last step.',
    inputSchema: z.object({}),
  }),
};
