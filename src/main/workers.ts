import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import { ensureWorkerImage, WORKER_IMAGE } from './docker';
import { nextWorkerName } from './worker-names';
import type { DelegationSelection } from '../shared/auth';
import { isTerminal, type Worker, type WorkerEvent, type WorkerStop } from '../shared/worker';

const MAX_STOPS = 8;
const PROGRESS_INTERVAL_MS = 5_000;

/** One line of the worker's stdout protocol (see docker/worker/entry.mjs). */
type WorkerMessage =
  | { type: 'ready' }
  | { type: 'tool'; id: string; tool: string; detail?: string }
  | { type: 'tool_result'; id: string; tool: string; result?: string; isError: boolean }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string };

const clock = () => new Date().toTimeString().slice(0, 5);

export type WorkerFleet = ReturnType<typeof createWorkerFleet>;

export function createWorkerFleet(options: {
  emit: (event: WorkerEvent) => void;
  getSelection: () => DelegationSelection;
  summarizeProgress: (input: {
    task: string;
    activity: string;
    recentSteps: string;
    previousSummary: string | null;
    mandatory: boolean;
  }) => Promise<string | null>;
  getWorkspace: () => string | null;
  agentDir: string;
}) {
  const workers = new Map<string, Worker>();
  const containers = new Set<string>();
  const inputs = new Map<string, Writable>();
  const containerByWorker = new Map<string, string>();
  const pendingSteers = new Map<string, string[]>();

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
    const current = workers.get(name);
    if (current && isTerminal(current.status)) return;
    switch (message.type) {
      case 'ready':
        patch(name, (worker) => ({ ...worker, status: 'running' }));
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
          stops: worker.stops.map((stop) =>
            stop.id === message.id
              ? {
                  ...stop,
                  status: message.isError ? 'error' : 'done',
                  result: message.result?.trim() || (message.isError ? 'Tool failed.' : 'Completed.'),
                }
              : stop,
          ),
        }));
        return;
      case 'done':
        patch(name, (worker) => ({ ...worker, status: 'done', summary: message.summary }), true);
        return;
      case 'error':
        fail(name, message.message);
        return;
    }
  }

  async function start(name: string, task: string) {
    const workspace = options.getWorkspace();
    if (!workspace) {
      fail(name, 'No workspace selected — choose a folder with WORKSPACE and dispatch again.');
      return;
    }

    try {
      await ensureWorkerImage();
    } catch (error) {
      fail(name, error instanceof Error ? error.message : String(error));
      return;
    }

    const currentBeforeSpawn = workers.get(name);
    if (!currentBeforeSpawn || isTerminal(currentBeforeSpawn.status)) return;

    const container = `ambient-worker-${name.toLowerCase()}-${Date.now()}`;
    containers.add(container);
    containerByWorker.set(name, container);

    const selection = options.getSelection();

    // The app-owned Pi credential directory is shared so OAuth refreshes remain
    // durable. Workers can read provider credentials, but still cannot see host files.
    const child = spawn(
      'docker',
      [
        'run', '--rm',
        '--name', container,
        '--memory=2g', '--cpus=2', '--pids-limit=512',
        '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--volume', `${workspace}:/work`,
        '--volume', `${options.agentDir}:/home/node/.pi/agent`,
        '-e', 'OPENAI_API_KEY', '-e', 'PI_TASK', '-e', 'PI_PROVIDER', '-e', 'PI_MODEL',
        WORKER_IMAGE,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PI_TASK: task,
          PI_PROVIDER: selection.provider,
          PI_MODEL: selection.model,
        },
      },
    );

    inputs.set(name, child.stdin);
    for (const instruction of pendingSteers.get(name) ?? []) {
      child.stdin.write(`${JSON.stringify({ type: 'steer', instruction })}\n`);
    }
    pendingSteers.delete(name);

    let buffer = '';
    let stderr = '';
    let lastProgressKey = '';
    let lastSpokenSummary: string | null = null;
    let runningTicks = 0;
    let summariesInFlight = 0;
    let latestEmittedSequence = 0;
    const progressTimer = setInterval(() => {
      const worker = workers.get(name);
      if (worker?.status !== 'running') return;
      runningTicks += 1;
      const mandatory = runningTicks <= 4; // 5s, 10s, 15s, and 20s
      const step = worker.stops.at(-1);
      const key = step
        ? `${worker.stops.length}:${step.tool}:${step.detail}:${step.status}:${step.result ?? ''}`
        : 'starting';

      // During the first twenty seconds, always provide orientation. Afterwards,
      // summarize only changed activity and never overlap filtering requests.
      if (!mandatory && (key === lastProgressKey || !step || summariesInFlight > 0)) return;
      if (!mandatory) lastProgressKey = key;

      const sequence = runningTicks;
      summariesInFlight += 1;
      void options
        .summarizeProgress({
          task: worker.task,
          activity: step
            ? `${step.tool}${step.detail ? ` — ${step.detail}` : ''}`
            : 'Analyzing the task and deciding the first action.',
          recentSteps: worker.stops
            .slice(-3)
            .map((item) => `${item.tool} [${item.status}]: ${item.detail}${item.result ? ` => ${item.result}` : ''}`)
            .join('\n'),
          previousSummary: lastSpokenSummary,
          mandatory,
        })
        .then((summary) => {
          if (!summary || sequence <= latestEmittedSequence) return;
          const current = workers.get(name);
          if (current?.status !== 'running') return;
          latestEmittedSequence = sequence;
          lastSpokenSummary = summary;
          const next = {
            ...current,
            updates: [...current.updates, { at: clock(), text: summary }].slice(-12),
          };
          workers.set(name, next);
          options.emit({ kind: 'progress', worker: next, summary });
        })
        .catch(() => {
          // Progress narration is best-effort and must never fail the worker.
        })
        .finally(() => {
          summariesInFlight -= 1;
          if (mandatory) lastProgressKey = key;
        });
    }, PROGRESS_INTERVAL_MS);

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
      clearInterval(progressTimer);
      inputs.delete(name);
      containerByWorker.delete(name);
      pendingSteers.delete(name);
      containers.delete(container);
      fail(name, error.message);
    });

    child.on('close', (code) => {
      clearInterval(progressTimer);
      inputs.delete(name);
      containerByWorker.delete(name);
      pendingSteers.delete(name);
      containers.delete(container);
      const worker = workers.get(name);
      if (!worker || isTerminal(worker.status)) return;
      fail(name, stderr.trim() || `worker exited with code ${code ?? 'unknown'}`);
    });
  }

  return {
    list: (): readonly Worker[] => [...workers.values()],

    stop(name: string) {
      const callsign = name.trim().toUpperCase();
      const worker = workers.get(callsign);
      if (!worker) return { ok: false as const, error: `Unknown worker ${callsign || name}` };
      if (isTerminal(worker.status)) {
        return { ok: false as const, error: `${callsign} is already ${worker.status}` };
      }

      pendingSteers.delete(callsign);
      inputs.get(callsign)?.write(`${JSON.stringify({ type: 'abort' })}\n`);
      patch(callsign, (current) => ({ ...current, status: 'cancelled' }), true);

      const container = containerByWorker.get(callsign);
      if (container) {
        // Give Pi a moment to abort cleanly, then make termination unconditional.
        setTimeout(() => {
          if (containers.has(container)) spawn('docker', ['kill', container], { stdio: 'ignore' }).unref();
        }, 1_500).unref();
      }
      return { ok: true as const, worker: callsign, status: 'stopped' as const };
    },

    steer(name: string, instruction: string) {
      const callsign = name.trim().toUpperCase();
      const worker = workers.get(callsign);
      if (!worker) return { ok: false as const, error: `Unknown worker ${callsign || name}` };
      if (worker.status !== 'queued' && worker.status !== 'running') {
        return { ok: false as const, error: `${callsign} is already ${worker.status}` };
      }
      const input = inputs.get(callsign);
      if (input) input.write(`${JSON.stringify({ type: 'steer', instruction })}\n`);
      else pendingSteers.set(callsign, [...(pendingSteers.get(callsign) ?? []), instruction]);
      const stop: WorkerStop = {
        id: `steer-${Date.now()}`,
        tool: 'steer',
        detail: instruction,
        status: 'done',
        result: 'Instruction queued for the active session.',
      };
      patch(callsign, (current) => ({ ...current, stops: [...current.stops, stop].slice(-MAX_STOPS) }));
      return { ok: true as const, worker: callsign, status: 'steering queued' as const };
    },

    /** Returns as soon as the worker has a name — the container starts behind it. */
    dispatch(task: string): Worker {
      const name = nextWorkerName(new Set(workers.keys()));
      const worker: Worker = {
        name,
        task,
        status: 'queued',
        startedAt: clock(),
        stops: [],
        updates: [],
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
