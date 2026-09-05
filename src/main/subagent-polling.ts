import type { WorkJob } from '../shared/router.ts';
import type { Worker } from '../shared/worker.ts';
import { isActive } from '../shared/worker.ts';

export const SUBAGENT_POLL_INTERVAL_MS = 5_000;

// Poll the fleet's IPC-fed state without interrupting the subagents' work.
export function startSubagentPolling(options: {
  getJobs: () => readonly WorkJob[];
  getWorkers: () => readonly Worker[];
  describeWorker: (worker: Worker) => string;
  enqueue: (jobId: string, prompt: () => string | null) => Promise<void>;
}) {
  const pending = new Set<string>();
  let stopped = false;
  const snapshot = (jobId: string) => {
    if (stopped) return null;
    const job = options.getJobs().find((item) => item.id === jobId);
    if (!job || !['accepted', 'routing', 'working'].includes(job.status)) return null;
    const children = options.getWorkers().filter((worker) =>
      worker.parentJobId === job.id && job.childWorkers.includes(worker.name));
    if (!children.some((worker) => isActive(worker.status))) return null;
    return { job, children };
  };
  const timer = setInterval(() => {
    for (const job of options.getJobs()) {
      if (pending.has(job.id) || !snapshot(job.id)) continue;
      pending.add(job.id);
      // Resolve at delivery time so queued polls cannot report stale progress.
      void options.enqueue(job.id, () => {
        const current = snapshot(job.id);
        if (!current) return null;
        return [
          'Event: subagent_status',
          `Job ID: ${current.job.id}`,
          `Original user request: ${current.job.request}`,
          `Elapsed seconds: ${Math.floor((Date.now() - current.job.createdAt) / 1_000)}`,
          'Current children:',
          ...current.children.map(options.describeWorker),
        ].join('\n');
      }).catch(() => {
        // A failed delivery must not disable polling for subsequent turns.
      }).finally(() => pending.delete(job.id));
    }
  }, SUBAGENT_POLL_INTERVAL_MS);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
