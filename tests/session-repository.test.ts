import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { openDatabase } from '../src/main/db/index.ts';
import { createSessionRepository } from '../src/main/db/session-repository.ts';
import type { WorkJob, WorkerReply } from '../src/shared/router.ts';
import type { PrimaryAgent, TimelineDisplay, Worker } from '../src/shared/worker.ts';
import { artifactOf } from '../src/main/agent-telemetry.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ambient-session-'));
  roots.push(root);
  const database = openDatabase(path.join(root, 'ambient.sqlite'), path.resolve('drizzle'));
  return { database, repository: createSessionRepository(database.db) };
}

const job = (id = 'job-1', status: WorkJob['status'] = 'accepted'): WorkJob => ({
  id,
  request: 'Compare local weather forecasts',
  status,
  childWorkers: [],
  networkEnabled: true,
  createdAt: 100,
  result: null,
  error: null,
});

const worker = (status: Worker['status'] = 'running'): Worker => ({
  name: 'KESTREL',
  task: 'Check forecast sources',
  parentJobId: 'job-1',
  status,
  startedAt: '07:12',
  stops: [],
  updates: [{ at: '07:13', text: 'Reading forecasts' }],
  artifacts: [],
  piSessionId: 'pi-worker-1',
  piSessionFile: '/sessions/worker-1.jsonl',
  summary: null,
  error: null,
});

test('persists a complete session snapshot and durable dismissal', async () => {
  const { database, repository } = await fixture();
  const session = repository.createSession('/workspace');
  repository.saveJob(session.id, job());
  repository.saveWorker(session.id, worker());
  const reply: WorkerReply = {
    id: 'reply-1',
    jobId: 'job-1',
    kind: 'progress',
    text: 'Checking two sources.',
    displayTitle: null,
    createdAt: 120,
  };
  repository.saveReply(session.id, reply);
  const display: TimelineDisplay = {
    id: 'display-1',
    widgetId: 'forecast',
    title: 'Forecast',
    format: 'markdown',
    content: 'Rain later.',
    alt: null,
    caption: null,
    links: [{ label: 'Source', url: 'https://example.com' }],
    createdAt: 130,
  };
  repository.saveDisplay(session.id, 'job-1', display);

  let snapshot = repository.snapshot(session.id);
  assert.equal(snapshot.session.title, 'Compare local weather forecasts');
  assert.deepEqual(snapshot.jobs, [job()]);
  assert.deepEqual(snapshot.workers, [worker()]);
  assert.deepEqual(snapshot.replies, [reply]);
  assert.deepEqual(snapshot.timelineItems, [{ job: job(), display, dismissed: false }]);
  assert.equal(snapshot.primaryAgent, null);

  repository.dismissDisplay(session.id, display.id);
  snapshot = repository.snapshot(session.id);
  assert.equal(snapshot.timelineItems[0]?.dismissed, true);
  assert.equal(repository.list()[0]?.jobCount, 1);
  database.close();
});

test('upserts mutable records instead of duplicating events', async () => {
  const { database, repository } = await fixture();
  const session = repository.createSession(null);
  repository.saveJob(session.id, job());
  repository.saveJob(session.id, {
    ...job(),
    request: 'Compare local weather forecasts\n\nUser follow-up: Focus on tomorrow.',
    status: 'working',
    childWorkers: ['KESTREL'],
  });
  repository.saveWorker(session.id, worker());
  repository.saveWorker(session.id, { ...worker(), status: 'complete', summary: 'Forecast checked.' });

  const snapshot = repository.snapshot(session.id);
  assert.equal(snapshot.jobs.length, 1);
  assert.equal(snapshot.jobs[0]?.status, 'working');
  assert.match(snapshot.jobs[0]?.request ?? '', /Focus on tomorrow/);
  assert.deepEqual(snapshot.jobs[0]?.childWorkers, ['KESTREL']);
  assert.equal(snapshot.workers.length, 1);
  assert.equal(snapshot.workers[0]?.status, 'complete');
  database.close();
});

test('reconciles active jobs and workers after a restart', async () => {
  const { database, repository } = await fixture();
  const session = repository.createSession(null);
  repository.saveJob(session.id, job('job-1', 'working'));
  repository.saveWorker(session.id, worker('running'));
  repository.reconcileInterrupted(session.id);

  const snapshot = repository.snapshot(session.id);
  assert.equal(snapshot.jobs[0]?.status, 'failed');
  assert.match(snapshot.jobs[0]?.error ?? '', /restart/);
  assert.equal(snapshot.workers[0]?.status, 'failed');
  assert.match(snapshot.workers[0]?.error ?? '', /restart/);
  database.close();
});

test('persists primary agent telemetry independently from one-shot workers', async () => {
  const { database, repository } = await fixture();
  const session = repository.createSession('/workspace');
  const primary: PrimaryAgent = {
    sessionId: session.id,
    name: 'PRIMARY',
    status: 'running',
    currentJobId: null,
    currentTask: 'Plan the request',
    startedAt: '18:40',
    stops: [{ id: 'tool-1', tool: 'read', detail: 'README.md', status: 'done', result: 'Completed.' }],
    updates: [{ at: '18:41', text: 'Reviewing the project.' }],
    artifacts: [{ path: '/workspace/report.md', tool: 'write' }],
    piSessionId: 'pi-primary-1',
    piSessionFile: '/sessions/primary.jsonl',
    error: null,
  };
  repository.savePrimaryAgent(primary);
  assert.deepEqual(repository.snapshot(session.id).primaryAgent, primary);

  repository.reconcileInterrupted(session.id);
  const reconciled = repository.snapshot(session.id).primaryAgent;
  assert.equal(reconciled?.status, 'idle');
  assert.match(reconciled?.error ?? '', /restart/);
  database.close();
});

test('captures write and edit artifacts only inside the workspace', () => {
  assert.deepEqual(artifactOf('write', { path: 'reports/result.md' }, '/workspace'), {
    path: '/workspace/reports/result.md',
    tool: 'write',
  });
  assert.equal(artifactOf('edit', { file_path: '../outside.txt' }, '/workspace'), null);
  assert.equal(artifactOf('read', { path: 'reports/result.md' }, '/workspace'), null);
});
