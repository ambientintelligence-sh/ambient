import { spawn } from 'node:child_process';
import { ensureWorkerImage, WORKER_IMAGE } from './docker';
import { nextWorkerName } from './worker-names';
import type { Worker, WorkerEvent, WorkerStop } from '../shared/worker';

const MAX_STOPS = 8;

/** One line of the worker's stdout protocol (see docker/worker/entry.mjs). */
type WorkerMessage =
  | { type: 'ready' }
  | { type: 'tool'; tool: string; detail?: string }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string };

const clock = () => new Date().toTimeString().slice(0, 5);

export type WorkerFleet = ReturnType<typeof createWorkerFleet>;

export function createWorkerFleet(options: { emit: (event: WorkerEvent) => void; model: string }) {
  const workers = new Map<string, Worker>();
  const containers = new Set<string>();

  const patch = (name: string, change: (worker: Worker) => Worker, report = false) => {
    const current = workers.get(name);
    if (!current) return;
    const next = change(current);
    workers.set(name, next);
    options.emit({ kind: report ? 'report' : 'update', worker: next });
  };

  const fail = (name: string, error: string) =>
    patch(name, (worker) => ({ ...worker, status: 'failed', error }), true);

  function handle(name: string, message: WorkerMessage) {
    switch (message.type) {
      case 'ready':
        patch(name, (worker) => ({ ...worker, status: 'running' }));
        return;
      case 'tool': {
        const stop: WorkerStop = { tool: message.tool, detail: message.detail ?? '' };
        patch(name, (worker) => ({ ...worker, stops: [...worker.stops, stop].slice(-MAX_STOPS) }));
        return;
      }
      case 'done':
        patch(name, (worker) => ({ ...worker, status: 'done', summary: message.summary }), true);
        return;
      case 'error':
        fail(name, message.message);
        return;
    }
  }

  async function start(name: string, task: string) {
    try {
      await ensureWorkerImage();
    } catch (error) {
      fail(name, error instanceof Error ? error.message : String(error));
      return;
    }

    if (workers.get(name)?.status === 'failed') return;

    const container = `ambient-worker-${name.toLowerCase()}-${Date.now()}`;
    containers.add(container);

    // Env is passed by name so neither the task nor the API key lands in argv,
    // where `docker inspect` and `ps` would expose it.
    const child = spawn(
      'docker',
      [
        'run', '--rm',
        '--name', container,
        '--memory=2g', '--cpus=2', '--pids-limit=512',
        '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '-e', 'OPENAI_API_KEY', '-e', 'PI_TASK', '-e', 'PI_MODEL',
        WORKER_IMAGE,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PI_TASK: task,
          PI_MODEL: options.model,
        },
      },
    );

    let buffer = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      // Strict LF framing — the worker never emits bare CR or unicode separators.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handle(name, JSON.parse(line) as WorkerMessage);
        } catch {
          // A non-JSON line is stray output from a dependency; ignore it.
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });

    child.on('error', (error) => {
      containers.delete(container);
      fail(name, error.message);
    });

    child.on('close', (code) => {
      containers.delete(container);
      const worker = workers.get(name);
      if (!worker || worker.status === 'done' || worker.status === 'failed') return;
      fail(name, stderr.trim() || `worker exited with code ${code ?? 'unknown'}`);
    });
  }

  return {
    list: (): readonly Worker[] => [...workers.values()],

    /** Returns as soon as the worker has a name — the container starts behind it. */
    dispatch(task: string): Worker {
      const name = nextWorkerName(new Set(workers.keys()));
      const worker: Worker = {
        name,
        task,
        status: 'queued',
        startedAt: clock(),
        stops: [],
        summary: null,
        error: null,
      };
      workers.set(name, worker);
      options.emit({ kind: 'update', worker });
      void start(name, task);
      return worker;
    },

    /** Containers are --rm, but a hard quit would otherwise leave them running. */
    shutdown() {
      for (const container of containers) {
        spawn('docker', ['kill', container], { stdio: 'ignore' }).unref();
      }
      containers.clear();
    },
  };
}
