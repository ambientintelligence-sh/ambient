import { access, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

const SECRET_ENV_PATTERN = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIALS?)(?:_|$)/i;

const isInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const sensitiveRoots = (agentDir: string) => {
  const home = homedir();
  return [
    agentDir,
    path.join(home, '.ssh'),
    path.join(home, '.gnupg'),
    path.join(home, '.aws'),
    path.join(home, '.azure'),
    path.join(home, '.kube'),
    path.join(home, '.config', 'gcloud'),
    path.join(home, 'Library', 'Keychains'),
    path.join(home, 'Library', 'Cookies'),
    path.join(home, 'Library', 'Safari'),
    path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
    path.join(home, 'Library', 'Application Support', 'Chromium'),
    path.join(home, 'Library', 'Application Support', 'Firefox'),
  ].map((item) => path.resolve(item));
};

const isSecretName = (candidate: string) => {
  const name = path.basename(candidate).toLowerCase();
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.pem') || name.endsWith('.key');
};

async function canonicalCandidate(candidate: string): Promise<string> {
  const absolute = path.resolve(candidate);
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      await access(current);
      const parent = await realpath(current);
      return path.join(parent, ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export type FilePolicy = Readonly<{
  workspace: string;
  tempDir: string;
  agentDir: string;
}>;

export async function authorizeRead(policy: FilePolicy, cwd: string, input: string): Promise<string> {
  const candidate = await canonicalCandidate(path.resolve(cwd, input));
  // Canonicalize the sensitive roots as well: on macOS /var is a symlink to
  // /private/var, so a root containing a symlink would otherwise never match
  // the canonicalized candidate.
  const roots = await Promise.all(sensitiveRoots(policy.agentDir).map(canonicalCandidate));
  if (isSecretName(candidate) || roots.some((root) => isInside(root, candidate))) {
    throw new Error(`Permission denied: ${input}`);
  }
  return candidate;
}

export async function authorizeWrite(policy: FilePolicy, cwd: string, input: string): Promise<string> {
  const candidate = await canonicalCandidate(path.resolve(cwd, input));
  const workspace = await canonicalCandidate(policy.workspace);
  const tempDir = await canonicalCandidate(policy.tempDir);
  if (!isInside(workspace, candidate) && !isInside(tempDir, candidate)) {
    throw new Error(`Permission denied: ${input}`);
  }
  const workspaceRelative = path.relative(workspace, candidate);
  if (workspaceRelative === '.git' || workspaceRelative.startsWith(`.git${path.sep}`) || isSecretName(candidate)) {
    throw new Error(`Permission denied: ${input}`);
  }
  return candidate;
}

export function secretEnvironmentNames(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = new Set([
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'EXA_API_KEY',
  ]);
  return Object.keys(env).filter((name) => explicit.has(name) || SECRET_ENV_PATTERN.test(name));
}

export function createFilesystemConfig(policy: FilePolicy): SandboxRuntimeConfig['filesystem'] {
  const home = homedir();
  const secretGlobs = (root: string) => [
    path.join(root, '**', '.env'),
    path.join(root, '**', '.env.*'),
    path.join(root, '**', '*.pem'),
    path.join(root, '**', '*.key'),
  ];
  const denyRead = [
    ...sensitiveRoots(policy.agentDir),
    ...secretGlobs(home),
    ...secretGlobs(policy.workspace),
    ...secretGlobs(policy.tempDir),
  ];
  return {
    denyRead,
    allowWrite: [policy.workspace, policy.tempDir],
    denyWrite: [path.join(policy.workspace, '.git'), ...denyRead],
  };
}

/**
 * Session config. Network egress is always routed through the sandbox proxy
 * with an empty allowlist; the per-job network toggle is enforced by the ask
 * callback registered alongside this config, so no re-initialization is needed
 * when the policy changes between commands.
 *
 * `allowLocalBinding` keeps loopback dev servers usable; it grants no egress
 * beyond the machine (outbound is still proxy-filtered).
 */
export function createSandboxConfig(policy: FilePolicy): SandboxRuntimeConfig {
  return {
    network: {
      allowedDomains: [],
      deniedDomains: [],
      allowLocalBinding: true,
    },
    filesystem: createFilesystemConfig(policy),
    credentials: {
      envVars: secretEnvironmentNames().map((name) => ({ name, mode: 'deny' as const })),
    },
    allowAppleEvents: false,
  };
}

export function sanitizeCommandEnvironment(
  env: NodeJS.ProcessEnv,
  tempDir: string,
): NodeJS.ProcessEnv {
  const blocked = new Set(secretEnvironmentNames(env));
  return Object.fromEntries(Object.entries({ ...env, TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir })
    .filter(([name, value]) => value !== undefined && !blocked.has(name)));
}

