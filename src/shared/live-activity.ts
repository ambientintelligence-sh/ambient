import { z } from 'zod';
import type { WorkJob } from './router.ts';

export const liveActivitySchema = z.object({
  summary: z.string().trim().min(1).max(180),
  status: z.enum(['running', 'blocked']),
  history: z.array(z.object({ summary: z.string(), at: z.number() })).default([]),
  // Read older persisted cards; new updates no longer need a plan.
  steps: z.array(z.object({
    label: z.string().trim().min(1).max(60),
    status: z.enum(['pending', 'active', 'complete']),
  })).min(1).max(5).optional(),
  updatedAt: z.number(),
});
export type LiveActivity = z.infer<typeof liveActivitySchema>;

export function readLiveActivity(content: string): LiveActivity | null {
  try { return liveActivitySchema.parse(JSON.parse(content)); } catch { return null; }
}

export function updateActivity(previous: LiveActivity | null, input: {
  summary: string; status: 'running' | 'blocked'; updatedAt: number;
}): LiveActivity {
  const next = liveActivitySchema.parse(input);
  if (previous?.summary === next.summary && previous.status === next.status) return previous;
  return {
    ...next,
    history: previous
      ? [...previous.history, { summary: previous.summary, at: previous.updatedAt }]
      : [],
  };
}

export function activityState(activity: LiveActivity, job: WorkJob) {
  if (job.status === 'complete') return { status: 'complete', summary: job.result ?? 'Finished.' } as const;
  if (job.status === 'failed' || job.status === 'cancelled') {
    return { status: job.status, summary: job.error ?? (job.status === 'cancelled' ? 'Stopped.' : 'Work interrupted.') } as const;
  }
  return { status: activity.status, summary: activity.summary };
}

// Some providers surface these control tokens as assistant text on silent turns.
export const cleanAgentText = (text: string) => text.replace(/(?:<\|eos\|>)+/g, '').trim();
