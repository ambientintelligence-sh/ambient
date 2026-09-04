import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRIMARY_AGENT_INSTRUCTIONS } from '../src/main/primary-agent-instructions.ts';
import { REALTIME_INSTRUCTIONS } from '../src/shared/config.ts';
import { readFileSync } from 'node:fs';

test('voice personality requires natural acknowledgements without capability refusals', () => {
  assert.match(REALTIME_INSTRUCTIONS, /specific acknowledgement/i);
  assert.match(REALTIME_INSTRUCTIONS, /not Ambient’s capability limit/i);
  assert.match(REALTIME_INSTRUCTIONS, /Most replies are 2 to 12 words/i);
  assert.match(REALTIME_INSTRUCTIONS, /Certainly/);
});

test('primary agent delegates slow work and never polls', () => {
  assert.match(PRIMARY_AGENT_INSTRUCTIONS, /exceed one second/i);
  assert.match(PRIMARY_AGENT_INSTRUCTIONS, /dispatch a subagent immediately/i);
  assert.match(PRIMARY_AGENT_INSTRUCTIONS, /Never wait, sleep, or poll/i);
  assert.match(PRIMARY_AGENT_INSTRUCTIONS, /remain available for new user requests and steering/i);
});

test('subagents balance Exa research with Chrome visual verification', () => {
  const subagent = readFileSync(new URL('../src/main/subagent.ts', import.meta.url), 'utf8');
  assert.match(subagent, /lightest tool that can provide the evidence/i);
  assert.match(subagent, /Prefer exa_search for ordinary research/i);
  assert.match(subagent, /webcams, queues, maps, rendered availability, screenshots/i);
  assert.match(subagent, /discover the right page or live feed with Exa, then inspect only that page with Chrome/i);
  assert.match(subagent, /direct visual verification materially improves the answer/i);
  assert.match(subagent, /finish as soon as the requested evidence is available/i);
  assert.match(subagent, /one focused fallback attempt/i);
});

test('widget-backed outcomes still speak the takeaway without directing the user', () => {
  assert.match(PRIMARY_AGENT_INSTRUCTIONS, /always speak the key outcome/i);
  assert.match(PRIMARY_AGENT_INSTRUCTIONS, /never refer to a widget, the screen/i);
  assert.match(REALTIME_INSTRUCTIONS, /even when visual details were also shown/i);
});

test('primary agent can stop unneeded subagents', () => {
  const router = readFileSync(new URL('../src/main/router.ts', import.meta.url), 'utf8');
  assert.match(router, /name: 'kill_subagents'/);
  assert.match(router, /options\.fleet\.stop/);
});

test('final results fall back to a widget when the primary agent omits one', () => {
  const router = readFileSync(new URL('../src/main/router.ts', import.meta.url), 'utf8');
  assert.match(router, /createFallbackResultDisplay/);
  assert.match(router, /kind === 'result' && !resolvedDisplayTitle/);
});

test('runtime event payloads contain facts rather than behavioral prompts', () => {
  const router = readFileSync(new URL('../src/main/router.ts', import.meta.url), 'utf8');
  const runtimeSection = router.slice(router.indexOf('async sendMessage(request:'), router.indexOf('list: (): readonly WorkJob[]'));
  assert.doesNotMatch(runtimeSection, /Complete the user|Re-evaluate|Do not poll|end the turn|send one natural|Apply it now/i);
  assert.match(runtimeSection, /Event: user_request/);
  assert.match(runtimeSection, /Event: user_steering/);
  assert.match(runtimeSection, /Event: subagent_report/);
  assert.match(runtimeSection, /Event: subagent_milestone/);
});
