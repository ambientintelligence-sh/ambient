import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { vendorNodeModules } from './vendor';
import { nextWorkerName } from './worker-names';
import type { DelegationSelection } from '../shared/auth';
import type { BrowserMode } from '../shared/browser';
import type { LocalContextState } from '../shared/local-context';
import { isTerminal, type Worker, type WorkerEvent, type WorkerStop } from '../shared/worker';
import type { SubagentLaunch, SubagentMessage } from './subagent-protocol';
import { completeStop } from './agent-telemetry';
import { subagentExitError } from './subagent-exit';

const MAX_STOPS = 8;
const clock = () => new Date().toTimeString().slice(0, 5);

export type WorkerFleet = ReturnType<typeof createWorkerFleet>;

export function createWorkerFleet(options: {
  sessionId: string;
  emit: (event: WorkerEvent) => void;
  getSelection: () => DelegationSelection;
  onReport: (worker: Worker) => void;
  onProgress: (worker: Worker) => void;
  getWorkspace: () => string | null;
  getBrowserConfig: () => Promise<{ mode: BrowserMode; browserUrl?: string; executablePath?: string }>;
  getLocalContext: () => LocalContextState;
  agentDir: string;
  tempRoot: string;
  subagentEntryPath: string;
  chromeMcpPath: string;
  sessionDir: string;
}) {
  const workers = new Map<string, Worker>();
  const processes = new Map<string, UtilityProcess>();
  const tempDirs = new Map<string, string>();

  const patch = (name: string, change: (worker: Worker) => Worker, report = false) => {
    const current = workers.get(name);
    if (!current) return null;
    const next = change(current);
    workers.set(name, next);
    options.emit({ kind: report ? 'report' : 'update', sessionId: options.sessionId, worker: next });
    if (report) options.onReport(next);
    return next;
  };

  const cleanup = (name: string) => {
    processes.delete(name);
    const tempDir = tempDirs.get(name);
    tempDirs.delete(name);
    if (tempDir) void rm(tempDir, { recursive: true, force: true });
  };

  const requestShutdown = (name: string, exitCode: 0 | 1) => {
    const child = processes.get(name);
    if (!child) return;
    child.postMessage({ type: 'shutdown', exitCode });
    setTimeout(() => child.kill(), 1_500).unref();
  };

  const fail = (name: string, error: string) => {
    const worker = workers.get(name);
    if (!worker || isTerminal(worker.status)) return;
    patch(name, (current) => ({ ...current, status: 'failed', error }), true);
  };

  function handle(name: string, message: SubagentMessage) {
    const current = workers.get(name);
    if (!current || isTerminal(current.status)) return;
    switch (message.type) {
      case 'ready':
        patch(name, (worker) => ({
          ...worker,
          status: 'running',
          piSessionId: message.piSessionId,
          piSessionFile: message.piSessionFile,
        }));
        return;
      case 'tool': {
        const stop: WorkerStop = {
          id: message.id,
          tool: message.tool,
          detail: message.detail ?? '',
          status: 'running',
          result: null,
        };
        patch(name, (worker) => ({ ...worker, stops: [...worker.stops, stop].slice(-MAX_STOPS) }));
        return;
      }
      case 'tool_result':
        patch(name, (worker) => ({
          ...worker,
          stops: completeStop(worker.stops, message.id, message.result?.trim() ?? '', message.isError),
        }));
        return;
      case 'artifact':
        patch(name, (worker) => ({
          ...worker,
          artifacts: worker.artifacts.some(({ path }) => path === message.artifact.path)
            ? worker.artifacts
            : [...worker.artifacts, message.artifact],
        }));
        return;
      case 'done':
        patch(name, (worker) => ({ ...worker, status: 'complete', summary: message.summary }), true);
        requestShutdown(name, 0);
        return;
      case 'progress':
        {
          const next = patch(name, (worker) => ({
          ...worker,
          updates: [...worker.updates, { at: clock(), text: message.text }].slice(-MAX_STOPS),
          }));
          if (next) options.onProgress(next);
        }
        return;
      case 'error':
        fail(name, message.message);
        requestShutdown(name, 1);
    }
  }

  async function start(name: string, task: string, networkEnabled: boolean) {
    const workspace = options.getWorkspace();
    if (!workspace) {
      fail(name, 'No workspace selected — choose a folder with WORKSPACE and dispatch again.');
      return;
    }
    try {
      await mkdir(options.tempRoot, { recursive: true, mode: 0o700 });
      const tempDir = await mkdtemp(path.join(options.tempRoot, 'subagent-'));
      tempDirs.set(name, tempDir);
      const browser = networkEnabled ? await options.getBrowserConfig() : { mode: 'headless' as const };
      const worker = workers.get(name);
      if (!worker || isTerminal(worker.status)) return;
      const launch: SubagentLaunch = {
        type: 'launch',
        task,
        workspace,
        tempDir,
        agentDir: options.agentDir,
        selection: options.getSelection(),
        localContext: options.getLocalContext(),
        networkEnabled,
        browser,
        chromeMcpPath: options.chromeMcpPath,
        sessionDir: options.sessionDir,
      };
      const child = utilityProcess.fork(options.subagentEntryPath, [], {
        cwd: workspace,
        env: { ...process.env, AMBIENT_VENDOR_NODE_MODULES: vendorNodeModules() },
        stdio: ['ignore', 'pipe', 'pipe'],
        serviceName: `Ambient Subagent ${name}`,
      });
      processes.set(name, child);
      let stderr = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-2_000);
      });
      child.on('message', (message: SubagentMessage) => handle(name, message));
      child.once('spawn', () => child.postMessage(launch));
      child.once('error', (_type, location) => fail(name, `Subagent process failed${location ? ` at ${location}` : ''}`));
      child.once('exit', (code) => {
        const current = workers.get(name);
        if (current && !isTerminal(current.status)) {
          const error = subagentExitError(code, stderr);
          if (error) fail(name, error);
          else {
            patch(name, (worker) => ({
              ...worker,
              status: 'complete',
              summary: worker.summary ?? worker.updates.at(-1)?.text ?? 'Finished with no closing summary.',
            }), true);
          }
        }
        cleanup(name);
      });
    } catch (error) {
      cleanup(name);
      fail(name, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    list: (): readonly Worker[] => [...workers.values()],

    stop(name: string) {
      const callsign = name.trim().toUpperCase();
      const worker = workers.get(callsign);
      if (!worker) return { ok: false as const, error: `Unknown worker ${callsign || name}` };
      if (isTerminal(worker.status)) return { ok: false as const, error: `${callsign} is already ${worker.status}` };
      patch(callsign, (current) => ({ ...current, status: 'cancelled' }), true);
      const child = processes.get(callsign);
      if (child) {
        child.postMessage({ type: 'abort' });
        setTimeout(() => child.kill(), 1_500).unref();
      }
      return { ok: true as const, worker: callsign, status: 'stopped' as const };
    },

    dispatch(task: string, parentJobId: string, networkEnabled: boolean): Worker {
      const name = nextWorkerName(new Set(workers.keys()));
      const worker: Worker = {
        name,
        task,
        parentJobId,
        status: 'queued',
        startedAt: clock(),
        stops: [],
        updates: [],
        artifacts: [],
        piSessionId: null,
        piSessionFile: null,
        summary: null,
        error: null,
      };
      workers.set(name, worker);
      options.emit({ kind: 'update', sessionId: options.sessionId, worker });
      void start(name, task, networkEnabled);
      return worker;
    },

    shutdown() {
      for (const child of processes.values()) child.kill();
      processes.clear();
      for (const tempDir of tempDirs.values()) void rm(tempDir, { recursive: true, force: true });
      tempDirs.clear();
    },
  };
}
