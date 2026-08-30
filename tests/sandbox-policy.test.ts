import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  authorizeRead,
  authorizeWrite,
  createSandboxConfig,
  sanitizeCommandEnvironment,
  secretEnvironmentNames,
  type FilePolicy,
} from '../src/main/sandbox-policy.ts';

async function fixture(): Promise<FilePolicy & { outside: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'ambient-policy-'));
  const [workspace, tempDir, agentDir, outside] = await Promise.all([
    mkdir(path.join(root, 'workspace'), { recursive: true }).then(() => path.join(root, 'workspace')),
    mkdir(path.join(root, 'task-tmp'), { recursive: true }).then(() => path.join(root, 'task-tmp')),
    mkdir(path.join(root, 'agent'), { recursive: true }).then(() => path.join(root, 'agent')),
    mkdir(path.join(root, 'outside'), { recursive: true }).then(() => path.join(root, 'outside')),
  ]);
  return { workspace, tempDir, agentDir, outside };
}

test('writes inside the workspace and task temp dir are allowed', async () => {
  const policy = await fixture();
  await writeFile(path.join(policy.workspace, 'note.md'), 'hello');
  const resolvedFile = await authorizeWrite(policy, policy.workspace, 'note.md');
  assert.equal(resolvedFile, await realpath(path.join(policy.workspace, 'note.md')));
  // New files (nearest existing parent canonicalization) are allowed too.
  const created = await authorizeWrite(policy, policy.workspace, 'src/new/file.ts');
  assert.ok(created.endsWith(path.join('src', 'new', 'file.ts')));
  const temp = await authorizeWrite(policy, policy.workspace, path.join(policy.tempDir, 'scratch.txt'));
  assert.ok(temp.startsWith(await realpath(policy.tempDir)));
});

test('writes outside the workspace fail: traversal, absolute, sibling', async () => {
  const policy = await fixture();
  await assert.rejects(authorizeWrite(policy, policy.workspace, '../escape.txt'), /Permission denied/);
  await assert.rejects(authorizeWrite(policy, policy.workspace, path.join(policy.outside, 'nope.txt')), /Permission denied/);
  await assert.rejects(authorizeWrite(policy, policy.workspace, '/etc/ambient-nope'), /Permission denied/);
  await assert.rejects(authorizeWrite(policy, policy.workspace, '~/ambient-nope'.replace('~', path.dirname(policy.workspace))), /Permission denied/);
});

test('symlink escapes fail for writes', async () => {
  const policy = await fixture();
  await writeFile(path.join(policy.outside, 'victim.txt'), 'original');
  await symlink(policy.outside, path.join(policy.workspace, 'link-out'), 'dir');
  await assert.rejects(authorizeWrite(policy, policy.workspace, 'link-out/victim.txt'), /Permission denied/);
  await symlink(path.join(policy.outside, 'victim.txt'), path.join(policy.workspace, 'link-file.txt'));
  await assert.rejects(authorizeWrite(policy, policy.workspace, 'link-file.txt'), /Permission denied/);
});

test('.git stays read-only and secret names are not writable', async () => {
  const policy = await fixture();
  await mkdir(path.join(policy.workspace, '.git'));
  await assert.rejects(authorizeWrite(policy, policy.workspace, '.git/config'), /Permission denied/);
  await assert.rejects(authorizeWrite(policy, policy.workspace, '.git/hooks/pre-commit'), /Permission denied/);
  await assert.rejects(authorizeWrite(policy, policy.workspace, '.env'), /Permission denied/);
  await assert.rejects(authorizeWrite(policy, policy.workspace, '.env.local'), /Permission denied/);
  await assert.rejects(authorizeWrite(policy, policy.workspace, 'certs/server.pem'), /Permission denied/);
  await assert.rejects(authorizeWrite(policy, policy.workspace, 'id_rsa.key'), /Permission denied/);
});

test('reads are broad except secrets and credential stores', async () => {
  const policy = await fixture();
  await writeFile(path.join(policy.workspace, 'ok.txt'), 'fine');
  assert.equal(await authorizeRead(policy, policy.workspace, 'ok.txt'), await realpath(path.join(policy.workspace, 'ok.txt')));
  // Broad reads outside the project are allowed by design.
  assert.equal(await authorizeRead(policy, policy.workspace, '/etc/hosts'), await realpath('/etc/hosts'));
  // Secret names are blocked wherever they live.
  await assert.rejects(authorizeRead(policy, policy.workspace, '.env'), /Permission denied/);
  await assert.rejects(authorizeRead(policy, policy.workspace, '.env.production'), /Permission denied/);
  await assert.rejects(authorizeRead(policy, policy.workspace, path.join(policy.outside, 'tls.key')), /Permission denied/);
  // Agent credentials and well-known credential stores are blocked.
  await assert.rejects(authorizeRead(policy, policy.workspace, path.join(policy.agentDir, 'auth.json')), /Permission denied/);
  await assert.rejects(authorizeRead(policy, policy.workspace, path.join(homedir(), '.ssh', 'id_rsa')), /Permission denied/);
  await assert.rejects(authorizeRead(policy, '/', path.join(homedir(), '.aws', 'credentials')), /Permission denied/);
});

test('symlinked workspace roots still authorize correctly', async () => {
  const policy = await fixture();
  const alias = path.join(path.dirname(policy.workspace), 'workspace-alias');
  await symlink(policy.workspace, alias, 'dir');
  const aliased = { ...policy, workspace: alias };
  await writeFile(path.join(policy.workspace, 'via-alias.txt'), 'x');
  const resolved = await authorizeWrite(aliased, alias, 'via-alias.txt');
  assert.equal(resolved, await realpath(path.join(policy.workspace, 'via-alias.txt')));
});

test('secret environment names are detected and stripped', () => {
  const env = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    OPENAI_API_KEY: 'sk-1',
    ANTHROPIC_API_KEY: 'sk-2',
    EXA_API_KEY: 'exa-3',
    AWS_SECRET_ACCESS_KEY: 'aws-4',
    GITHUB_TOKEN: 'ghp-5',
    MY_DB_PASSWORD: 'pw-6',
  };
  const names = secretEnvironmentNames(env);
  for (const expected of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'EXA_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'MY_DB_PASSWORD']) {
    assert.ok(names.includes(expected), `expected ${expected} to be treated as secret`);
  }
  assert.ok(!names.includes('PATH') && !names.includes('HOME'));
  const sanitized = sanitizeCommandEnvironment(env, '/private/tmp/task');
  assert.equal(sanitized.OPENAI_API_KEY, undefined);
  assert.equal(sanitized.GITHUB_TOKEN, undefined);
  assert.equal(sanitized.PATH, '/usr/bin');
  assert.equal(sanitized.TMPDIR, '/private/tmp/task');
  assert.equal(sanitized.TMP, '/private/tmp/task');
  assert.equal(sanitized.TEMP, '/private/tmp/task');
});

test('sandbox runtime config encodes the filesystem policy and blocked egress', async () => {
  const policy = await fixture();
  process.env.OPENAI_API_KEY = 'sk-test';
  const config = createSandboxConfig(policy);
  delete process.env.OPENAI_API_KEY;
  assert.deepEqual(config.network.allowedDomains, []);
  assert.equal(config.network.allowLocalBinding, true);
  assert.deepEqual(config.filesystem.allowWrite, [policy.workspace, policy.tempDir]);
  assert.ok(config.filesystem.denyWrite.includes(path.join(policy.workspace, '.git')));
  assert.ok(config.filesystem.denyRead.some((entry) => entry.endsWith('.env')));
  assert.ok(config.filesystem.denyRead.includes(policy.agentDir));
  assert.equal(config.allowAppleEvents, false);
  const denied = (config.credentials?.envVars ?? []).map((entry) => entry.name);
  assert.ok(denied.includes('OPENAI_API_KEY'));
});
