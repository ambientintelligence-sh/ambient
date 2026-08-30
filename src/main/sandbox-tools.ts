import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type {
  BashOperations,
  ExtensionFactory,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  authorizeRead,
  authorizeWrite,
  createFilesystemConfig,
  createSandboxConfig,
  sanitizeCommandEnvironment,
  type FilePolicy,
} from './sandbox-policy';
import { vendorModuleUrl } from './vendor';

type SandboxRuntimeModule = typeof import('@anthropic-ai/sandbox-runtime');
type SandboxManagerApi = SandboxRuntimeModule['SandboxManager'];
type PiModule = typeof import('@earendil-works/pi-coding-agent');

// Keep these packages out of the vite bundle; they are resolved from the
// vendored node_modules at runtime (same pattern as the router's pi import).
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

export class SandboxController {
  private manager: SandboxManagerApi | null = null;
  private ready: Promise<void> | null = null;
  /**
   * Read by the proxy ask callback for each egress request. Set before every
   * exec from the owning job's captured network policy. Router turns are
   * mailbox-serialized (and subagents have one fixed policy per process), so
   * concurrent commands in one process never disagree on the value.
   */
  private networkAllowed = false;

  private ensure(policy: FilePolicy) {
    this.ready ??= (async () => {
      const { SandboxManager } = await importEsm<SandboxRuntimeModule>(vendorModuleUrl('@anthropic-ai/sandbox-runtime'));
      if (!SandboxManager.isSupportedPlatform()) throw new Error(`Sandboxing is unavailable on ${process.platform}`);
      await SandboxManager.initialize(createSandboxConfig(policy), async () => this.networkAllowed);
      if (!SandboxManager.isSandboxingEnabled()) throw new Error('Sandbox initialization failed');
      this.manager = SandboxManager;
    })();
    return this.ready;
  }

  operations(getPolicy: () => FilePolicy, getNetworkEnabled: () => boolean): BashOperations {
    return {
      exec: async (command, cwd, { onData, signal, timeout, env }) => {
        const policy = getPolicy();
        this.networkAllowed = getNetworkEnabled();
        await this.ensure(policy);
        if (!existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`);
        const manager = this.manager;
        if (!manager) throw new Error('Sandbox is unavailable');
        const wrapped = await manager.wrapWithSandbox(
          command,
          'bash',
          // Filesystem policy is per-command so workspace/temp changes never
          // require a proxy restart.
          { filesystem: createFilesystemConfig(policy) },
          signal,
          { commandId: randomUUID(), commandText: command },
        );
        return new Promise((resolve, reject) => {
          const child = spawn('bash', ['-c', wrapped], {
            cwd,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: sanitizeCommandEnvironment(env ?? process.env, policy.tempDir),
          });
          let timedOut = false;
          const stop = () => {
            if (!child.pid) return;
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {
              child.kill('SIGKILL');
            }
          };
          const timer = timeout && timeout > 0
            ? setTimeout(() => {
                timedOut = true;
                stop();
              }, timeout * 1_000)
            : null;
          const onAbort = () => stop();
          signal?.addEventListener('abort', onAbort, { once: true });
          child.stdout?.on('data', onData);
          child.stderr?.on('data', onData);
          child.once('error', reject);
          child.once('close', (code) => {
            if (timer) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            manager.cleanupAfterCommand();
            if (signal?.aborted) reject(new Error('Operation aborted'));
            else if (timedOut) reject(new Error(`Command timed out after ${timeout} seconds`));
            else resolve({ exitCode: code });
          });
        });
      },
    };
  }

  async reset() {
    try {
      await this.ready;
    } catch {
      // Initialization failed; nothing live to reset.
    }
    if (this.manager?.isSandboxingEnabled()) await this.manager.reset();
    this.manager = null;
    this.ready = null;
  }
}

export async function createSandboxExtension(options: {
  cwd: string;
  controller: SandboxController;
  getPolicy: () => FilePolicy;
  getNetworkEnabled: () => boolean;
}): Promise<ExtensionFactory> {
  const pi = await importEsm<PiModule>(vendorModuleUrl('@earendil-works/pi-coding-agent'));
  const bash = pi.createBashToolDefinition(options.cwd, {
    operations: options.controller.operations(options.getPolicy, options.getNetworkEnabled),
    exposeSessionEnvironment: false,
  });

  return (api) => {
    api.registerTool(bash as ToolDefinition);
    api.on('tool_call', async (event) => {
      try {
        if (event.toolName === 'read' || event.toolName === 'ls') {
          const input = event.input as { path?: string };
          await authorizeRead(options.getPolicy(), options.cwd, input.path || '.');
        } else if (event.toolName === 'write' || event.toolName === 'edit') {
          const input = event.input as { path?: string };
          if (!input.path) throw new Error('A file path is required');
          await authorizeWrite(options.getPolicy(), options.cwd, input.path);
        }
      } catch (error) {
        return { block: true, reason: error instanceof Error ? error.message : 'Permission denied' };
      }

      const networkTool = event.toolName === 'exa_search'
        || event.toolName === 'mcp'
        || event.toolName.startsWith('mcp__');
      if (networkTool && !options.getNetworkEnabled()) {
        return { block: true, reason: 'Network access is disabled for this work item' };
      }
      return undefined;
    });
  };
}
