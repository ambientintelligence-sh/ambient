import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import {
  createFilesystemConfig,
  createSandboxConfig,
  sanitizeCommandEnvironment,
  type FilePolicy,
} from '../src/main/sandbox-policy.ts';

// End-to-end enforcement checks through Sandbox Runtime's seatbelt wrapper.
// macOS only — the Linux backend is out of scope for now.
const darwin = process.platform === 'darwin';

let networkAllowed = false;
let policy: FilePolicy & { outside: string };

async function runSandboxed(command: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const wrapped = await SandboxManager.wrapWithSandbox(command, 'bash', { filesystem: createFilesystemConfig(policy) });
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    execFile(
      'bash',
      ['-c', wrapped],
      {
        cwd: options.cwd ?? policy.workspace,
        env: sanitizeCommandEnvironment(options.env ?? process.env, policy.tempDir),
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        resolve({ code: typeof error?.code === 'number' ? error.code : 0, output: `${stdout}${stderr}` });
      },
    );
  });
}

const exists = (target: string) => access(target).then(() => true).catch(() => false);

test.before(async () => {
  if (!darwin) return;
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'ambient-sandbox-')));
  policy = {
    workspace: path.join(root, 'workspace'),
    tempDir: path.join(root, 'task-tmp'),
    agentDir: path.join(root, 'agent'),
    outside: path.join(root, 'outside'),
  };
  await mkdir(policy.workspace, { recursive: true });
  await mkdir(policy.tempDir, { recursive: true });
  await mkdir(policy.agentDir, { recursive: true });
  await mkdir(policy.outside, { recursive: true });
  await mkdir(path.join(policy.workspace, '.git'), { recursive: true });
  await writeFile(path.join(policy.agentDir, 'auth.json'), '{"token":"secret"}');
  await writeFile(path.join(policy.workspace, '.env'), 'TOKEN=secret');
  await SandboxManager.initialize(createSandboxConfig(policy), async () => networkAllowed);
});

test.after(async () => {
  if (!darwin) return;
  await SandboxManager.reset().catch(() => undefined);
  await rm(path.dirname(policy.workspace), { recursive: true, force: true }).catch(() => undefined);
});

test('bash: project edits succeed', { skip: !darwin }, async () => {
  const result = await runSandboxed('echo hello > notes.txt && cat notes.txt');
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /hello/);
});

test('bash: writes outside the workspace fail', { skip: !darwin }, async () => {
  const absolute = path.join(policy.outside, 'nope.txt');
  const result = await runSandboxed(`echo x > ${JSON.stringify(absolute)}`);
  assert.notEqual(result.code, 0);
  assert.equal(await exists(absolute), false);
  const traversal = path.join(policy.outside, 'escape.txt');
  const escaped = await runSandboxed('echo x > ../outside/escape.txt');
  assert.notEqual(escaped.code, 0);
  assert.equal(await exists(traversal), false);
});

test('bash: .git writes fail', { skip: !darwin }, async () => {
  const target = path.join(policy.workspace, '.git', 'tampered');
  const result = await runSandboxed('touch .git/tampered');
  assert.notEqual(result.code, 0);
  assert.equal(await exists(target), false);
});

test('bash: secret files cannot be read', { skip: !darwin }, async () => {
  const agentSecret = await runSandboxed(`cat ${JSON.stringify(path.join(policy.agentDir, 'auth.json'))}`);
  assert.notEqual(agentSecret.code, 0);
  assert.doesNotMatch(agentSecret.output, /secret/);
  const dotenv = await runSandboxed('cat .env');
  assert.notEqual(dotenv.code, 0);
  assert.doesNotMatch(dotenv.output, /TOKEN=secret/);
});

test('bash: secret environment variables are not visible', { skip: !darwin }, async () => {
  const result = await runSandboxed('printenv OPENAI_API_KEY; printenv GH_TOKEN; echo done', {
    env: { ...process.env, OPENAI_API_KEY: 'sk-test', GH_TOKEN: 'ghp-test' },
  });
  assert.match(result.output, /done/);
  assert.doesNotMatch(result.output, /sk-test|ghp-test/);
});

test('bash: network OFF blocks HTTP and raw TCP', { skip: !darwin }, async () => {
  networkAllowed = false;
  const http = await runSandboxed('curl -sS -m 15 https://example.com -o /dev/null');
  assert.notEqual(http.code, 0, http.output);
  const tcp = await runSandboxed('echo ping > /dev/tcp/93.184.215.14/80');
  assert.notEqual(tcp.code, 0, tcp.output);
});

test('bash: network ON permits HTTP through the proxy', { skip: !darwin, timeout: 60_000 }, async (t) => {
  try {
    await fetch('https://example.com', { signal: AbortSignal.timeout(8_000) });
  } catch {
    t.skip('host has no outbound network access');
    return;
  }
  networkAllowed = true;
  try {
    const result = await runSandboxed('curl -sS -m 20 https://example.com');
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Example Domain/);
  } finally {
    networkAllowed = false;
  }
});
