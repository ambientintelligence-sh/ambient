import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityState, updateActivity, cleanAgentText, readLiveActivity, type LiveActivity } from '../src/shared/live-activity.ts';
import type { WorkJob } from '../src/shared/router.ts';

const activity: LiveActivity = {
  summary: 'Checking the latest forecast', status: 'running', history: [],
  steps: [{ label: 'Compare sources', status: 'active' }], updatedAt: 100,
};
const job: WorkJob = {
  id: 'one', request: 'Weather', status: 'working', childWorkers: [],
  networkEnabled: true, createdAt: 0, result: null, error: null,
};

test('control markers do not become progress notes, while real content is preserved', () => {
  assert.equal(cleanAgentText('<|eos|><|eos|>'), '');
  assert.equal(cleanAgentText('Found the source.<|eos|>'), 'Found the source.');
  assert.equal(cleanAgentText('Ordinary text'), 'Ordinary text');
});

test('activity validates persisted data without throwing on malformed content', () => {
  assert.deepEqual(readLiveActivity(JSON.stringify(activity)), activity);
  for (const content of ['<html>', 'null', '{}', JSON.stringify({ ...activity, steps: [] })]) {
    assert.equal(readLiveActivity(content), null);
  }
});

test('terminal job states override stale running or blocked cards', () => {
  assert.deepEqual(activityState(activity, job), { status: 'running', summary: activity.summary });
  assert.equal(activityState({ ...activity, status: 'blocked' }, job).status, 'blocked');
  assert.deepEqual(activityState(activity, { ...job, status: 'complete', result: 'Rain tonight.' }), { status: 'complete', summary: 'Rain tonight.' });
  assert.deepEqual(activityState(activity, { ...job, status: 'failed', error: 'Interrupted by restart.' }), { status: 'failed', summary: 'Interrupted by restart.' });
  assert.deepEqual(activityState(activity, { ...job, status: 'cancelled' }), { status: 'cancelled', summary: 'Stopped.' });
});


test('history accumulates changed updates without duplicating unchanged polls', () => {
  const first = updateActivity(null, { summary: 'Finding sources', status: 'running', updatedAt: 1 });
  const repeated = updateActivity(first, { summary: 'Finding sources', status: 'running', updatedAt: 2 });
  assert.deepEqual(repeated, first);
  const next = updateActivity(repeated, { summary: 'Reading live reports', status: 'running', updatedAt: 3 });
  assert.deepEqual(next.history, [{ summary: 'Finding sources', at: 1 }]);
  assert.deepEqual(readLiveActivity(JSON.stringify(next)), next);
  const blocked = updateActivity(next, { summary: 'Source unavailable', status: 'blocked', updatedAt: 4 });
  assert.equal(blocked.history.length, 2);
});
