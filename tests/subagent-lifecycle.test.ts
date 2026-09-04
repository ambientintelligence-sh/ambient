import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subagentExitError } from '../src/main/subagent-exit.ts';
import { createFallbackResultDisplay, MAX_WIDGET_TEXT_LENGTH } from '../src/main/result-display.ts';
import { shouldSpeakReply, type WorkerReply } from '../src/shared/router.ts';

const reply = (displayTitle: string | null): WorkerReply => ({
  id: 'reply-1',
  jobId: 'job-1',
  kind: 'result',
  text: 'The detailed result.',
  displayTitle,
  createdAt: 1,
});

test('a clean subagent exit is successful even if the final IPC message races it', () => {
  assert.equal(subagentExitError(0, ''), null);
  assert.equal(subagentExitError(0, 'non-fatal diagnostic'), null);
  assert.equal(subagentExitError(1, ''), 'Subagent exited with code 1');
  assert.equal(subagentExitError(1, 'fatal error'), 'fatal error');
});

test('a displayed result still gets a concise spoken outcome', () => {
  assert.equal(shouldSpeakReply(reply('Forecast')), true);
  assert.equal(shouldSpeakReply(reply(null)), true);
  assert.equal(shouldSpeakReply({ ...reply('Forecast'), kind: 'error' }), true);
});

test('a final result without a custom display gets a persistent fallback widget', () => {
  const display = createFallbackResultDisplay({
    id: 'job-1',
    request: '  Compare   tomorrow’s forecasts  ',
  }, 'x'.repeat(MAX_WIDGET_TEXT_LENGTH + 20), 123);

  assert.equal(display.id, 'job-1-result');
  assert.equal(display.widgetId, 'result');
  assert.equal(display.title, 'Compare tomorrow’s forecasts');
  assert.equal(display.format, 'markdown');
  assert.equal(display.content.length, MAX_WIDGET_TEXT_LENGTH);
  assert.equal(display.createdAt, 123);
});
