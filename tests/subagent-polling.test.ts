import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startSubagentPolling } from '../src/main/subagent-polling.ts';
import type { WorkJob } from '../src/shared/router.ts';
import type { Worker } from '../src/shared/worker.ts';

const job: WorkJob = {
  id: 'job-1', request: 'Compare forecasts', status: 'working',
  childWorkers: ['ALPHA', 'BETA'], networkEnabled: true, createdAt: 0, result: null, error: null,
};
const worker = (name: string, status: Worker['status'] = 'running'): Worker => ({
  name, status, parentJobId: job.id, task: job.request, startedAt: '12:00',
  stops: [], updates: [], artifacts: [], piSessionId: null, piSessionFile: null,
  summary: null, error: null,
});
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('polls every five seconds, batches siblings, and coalesces pending turns', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let workers = [worker('ALPHA'), worker('BETA'), { ...worker('OTHER'), parentJobId: 'another-job' }];
  const queued: Array<() => string | null> = [];
  let finish!: () => void;
  const stop = startSubagentPolling({
    getJobs: () => [job], getWorkers: () => workers,
    describeWorker: (item) => `${item.name}: ${item.status}`,
    enqueue: async (id, prompt) => {
      assert.equal(id, job.id);
      queued.push(prompt);
      await new Promise<void>((resolve) => { finish = resolve; });
    },
  });
  t.after(stop);
  t.mock.timers.tick(4_999);
  assert.equal(queued.length, 0);
  t.mock.timers.tick(1);
  assert.equal(queued.length, 1);
  t.mock.timers.tick(20_000);
  assert.equal(queued.length, 1);
  workers = [worker('ALPHA', 'complete'), worker('BETA')];
  assert.match(queued[0]()!, /ALPHA: complete\nBETA: running/);
  assert.doesNotMatch(queued[0]()!, /OTHER/);
  finish();
  await flush();
  t.mock.timers.tick(5_000);
  assert.equal(queued.length, 2);
  finish();
});

test('queued snapshots expire on completion, cancellation, and shutdown', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let jobs = [job];
  let workers = [worker('ALPHA')];
  const queued: Array<() => string | null> = [];
  const stop = startSubagentPolling({
    getJobs: () => jobs, getWorkers: () => workers,
    describeWorker: (item) => item.name,
    enqueue: async (_id, prompt) => { queued.push(prompt); },
  });
  t.after(stop);
  t.mock.timers.tick(5_000);
  workers = [worker('ALPHA', 'complete')];
  assert.equal(queued[0](), null);
  await flush();
  t.mock.timers.tick(5_000);
  assert.equal(queued.length, 1);
  workers = [worker('ALPHA')];
  for (const status of ['cancelled', 'failed', 'complete'] as const) {
    jobs = [{ ...job, status }];
    assert.equal(queued[0](), null);
    t.mock.timers.tick(5_000);
    assert.equal(queued.length, 1);
  }
  jobs = [job];
  t.mock.timers.tick(5_000);
  assert.equal(queued.length, 2);
  stop();
  assert.equal(queued[1](), null);
  await flush();
  t.mock.timers.tick(10_000);
  assert.equal(queued.length, 2);
});

test('polling resumes after a failed delivery and skips jobs without active children', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let workers: Worker[] = [];
  let calls = 0;
  const stop = startSubagentPolling({
    getJobs: () => [job], getWorkers: () => workers,
    describeWorker: (item) => item.name,
    enqueue: async () => { calls++; throw new Error('delivery failed'); },
  });
  t.after(stop);
  t.mock.timers.tick(5_000);
  assert.equal(calls, 0);
  workers = [worker('ALPHA', 'queued')];
  t.mock.timers.tick(5_000);
  assert.equal(calls, 1);
  await flush();
  t.mock.timers.tick(5_000);
  assert.equal(calls, 2);
  await flush();
});
