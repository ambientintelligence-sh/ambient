import { spawn } from 'node:child_process';
import { ensureWorkerImage, WORKER_IMAGE } from './docker';
import { nextWorkerName } from './worker-names';
import type { DelegationSelection } from '../shared/auth';
import type { BrowserMode } from '../shared/browser';
import { formatCurrentContext, type LocalContextState } from '../shared/local-context';
import { isTerminal, type Worker, type WorkerDisplay, type WorkerEvent, type WorkerStop } from '../shared/worker';

const MAX_STOPS = 8;
const PROGRESS_INTERVAL_MS = 10_000;

/** One line of the worker's stdout protocol (see docker/worker/entry.mjs). */
type WorkerMessage =
  | { type: 'ready' }
  | { type: 'tool'; id: string; tool: string; detail?: string }
  | { type: 'tool_result'; id: string; tool: string; result?: string; isError: boolean }
  | { type: 'display'; widgetId?: string | null; title: string; format?: 'html' | 'markdown' | 'image'; content?: string; html?: string; alt?: string | null; caption?: string | null; links?: { label: string; url: string }[] }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string };

const clock = () => new Date().toTimeString().slice(0, 5);

export type WorkerFleet = ReturnType<typeof createWorkerFleet>;

export function createWorkerFleet(options: {
  emit: (event: WorkerEvent) => void;
  getSelection: () => DelegationSelection;
  summarizeProgress: (input: {
    activities: readonly {
      task: string;
      activity: string;
      recentSteps: string;
    }[];
    previousSummary: string | null;
    mandatory: boolean;
  }) => Promise<string | null>;
  getWorkspace: () => string | null;
  getBrowserConfig: () => Promise<{ mode: BrowserMode; browserUrl?: string }>;
  getLocalContext: () => LocalContextState;
  agentDir: string;
}) {
  const workers = new Map<string, Worker>();
  const containers = new Set<string>();
  const containerByWorker = new Map<string, string>();
  const readyWorkers = new Set<string>();
  const pendingSteers = new Map<string, string[]>();
  let lastFleetKey = '';
  let lastFleetSummary: string | null = null;
  let fleetSummarizing = false;

  const progressTimer = setInterval(() => {
    const active = [...workers.values()].filter((worker) => worker.status === 'running');
    if (active.length === 0) {
      lastFleetKey = '';
      lastFleetSummary = null;
      return;
    }
    if (fleetSummarizing) return;

    const activities = active.map((worker) => {
      const step = worker.stops.at(-1);
      return {
        task: worker.task,
        activity: step
          ? `${step.tool}${step.detail ? ` — ${step.detail}` : ''}`
          : 'Analyzing the task and deciding the first action.',
        recentSteps: worker.stops
          .slice(-3)
          .map((item) => `${item.tool} [${item.status}]: ${item.detail}${item.result ? ` => ${item.result}` : ''}`)
          .join('\n'),
      };
    });
    const key = active.map((worker) => {
      const step = worker.stops.at(-1);
      return `${worker.name}:${worker.stops.length}:${step?.tool ?? 'starting'}:${step?.detail ?? ''}:${step?.status ?? ''}`;
    }).join('|');
    const changed = key !== lastFleetKey;
    if (!changed) return;

    fleetSummarizing = true;
    lastFleetKey = key;
    void options.summarizeProgress({ activities, previousSummary: lastFleetSummary, mandatory: false })
      .then((summary) => {
        if (!summary) return;
        const current = [...workers.values()].filter((worker) => worker.status === 'running');
        if (current.length === 0) return;
        lastFleetSummary = summary;
        options.emit({ kind: 'fleet-progress', workers: current, summary });
      })
      .catch(() => {
        // Progress narration is best-effort and must never fail workers.
      })
      .finally(() => {
        fleetSummarizing = false;
      });
  }, PROGRESS_INTERVAL_MS);

  const patch = (name: string, change: (worker: Worker) => Worker, report = false) => {
    const current = workers.get(name);
    if (!current) return;
    const next = change(current);
    workers.set(name, next);
    options.emit({ kind: report ? 'report' : 'update', worker: next });
  };

  const fail = (name: string, error: string) =>
    patch(name, (worker) => ({ ...worker, status: 'failed', error }), true);

  function sendControl(name: string, command: object) {
    const container = containerByWorker.get(name);
    if (!container) return false;
    const control = spawn(
      'docker',
      ['exec', '-i', container, 'sh', '-c', 'cat >> /tmp/ambient-control.jsonl'],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    control.stdin.end(`${JSON.stringify(command)}\n`);
    return true;
  }

  function handle(name: string, message: WorkerMessage) {
    const current = workers.get(name);
    if (current && isTerminal(current.status)) return;
    switch (message.type) {
      case 'ready':
        readyWorkers.add(name);
        patch(name, (worker) => ({ ...worker, status: 'running' }));
        for (const instruction of pendingSteers.get(name) ?? []) {
          sendControl(name, { type: 'steer', instruction });
        }
        pendingSteers.delete(name);
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
      case 'display':
        {
          const format = message.format ?? 'html';
          const content = message.content ?? message.html ?? '';
          if (!content) return;
        patch(name, (worker) => {
          const widgetId = message.widgetId?.trim().slice(0, 80) || null;
          const existing = widgetId ? worker.displays.find((display) => display.widgetId === widgetId) : null;
          const display: WorkerDisplay = {
            id: existing?.id ?? `${name}-${Date.now()}-${worker.displays.length}`,
            widgetId,
            title: message.title.trim().slice(0, 120) || 'Result',
            format,
            content: content.slice(0, format === 'image' ? 7_000_000 : 120_000),
            alt: message.alt?.trim().slice(0, 300) || null,
            caption: message.caption?.trim().slice(0, 2_000) || null,
            links: (message.links ?? []).filter(({ url }) => /^https?:\/\//i.test(url)).slice(0, 4).map(({ label, url }) => ({
              label: label.trim().slice(0, 60) || 'Open link',
              url: url.trim().slice(0, 2_000),
            })),
            createdAt: existing?.createdAt ?? Date.now(),
          };
          return {
            ...worker,
            displays: existing
              ? worker.displays.map((item) => item.id === existing.id ? display : item)
              : [...worker.displays, display],
          };
        });
        return;
        }
      case 'done':
        // Progress is provisional telemetry. Once a checkpoint arrives, remove
        // those lines so stale observations cannot contradict the final report.
        patch(name, (worker) => ({
          ...worker,
          status: 'idle',
          updates: [],
          summary: message.summary,
        }), true);
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

    let browserConfig: { mode: BrowserMode; browserUrl?: string };
    try {
      browserConfig = await options.getBrowserConfig();
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
    const localContext = options.getLocalContext();
    const currentContext = formatCurrentContext(localContext);

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
        '-e', 'OPENAI_API_KEY', '-e', 'EXA_API_KEY', '-e', 'EXA_USER_LOCATION',
        '-e', 'PI_TASK', '-e', 'PI_PROVIDER', '-e', 'PI_MODEL',
        '-e', 'PI_BROWSER_MODE', '-e', 'PI_BROWSER_URL', '-e', 'PI_CURRENT_CONTEXT',
        WORKER_IMAGE,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PI_TASK: task,
          PI_PROVIDER: selection.provider,
          PI_MODEL: selection.model,
          EXA_USER_LOCATION: localContext.countryCode ?? '',
          PI_CURRENT_CONTEXT: currentContext,
          PI_BROWSER_MODE: browserConfig.mode,
          PI_BROWSER_URL: browserConfig.browserUrl ?? '',
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
      readyWorkers.delete(name);
      containerByWorker.delete(name);
      pendingSteers.delete(name);
      containers.delete(container);
      fail(name, error.message);
    });

    child.on('close', (code) => {
      readyWorkers.delete(name);
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
      if (readyWorkers.has(callsign)) sendControl(callsign, { type: 'abort' });
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
      if (worker.status !== 'queued' && worker.status !== 'running' && worker.status !== 'idle') {
        return { ok: false as const, error: `${callsign} is ${worker.status}` };
      }
      const contextualInstruction = `${instruction}\n\n${formatCurrentContext(options.getLocalContext())}`;
      if (readyWorkers.has(callsign)) sendControl(callsign, { type: 'steer', instruction: contextualInstruction });
      else pendingSteers.set(callsign, [...(pendingSteers.get(callsign) ?? []), contextualInstruction]);
      const stop: WorkerStop = {
        id: `steer-${Date.now()}`,
        tool: 'steer',
        detail: instruction,
        status: 'done',
        result: 'Instruction queued for the active session.',
      };
      patch(callsign, (current) => ({
        ...current,
        status: current.status === 'idle' ? 'running' : current.status,
        summary: current.status === 'idle' ? null : current.summary,
        stops: [...current.stops, stop].slice(-MAX_STOPS),
      }));
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
        displays: [],
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
      clearInterval(progressTimer);
      for (const container of containers) {
        spawn('docker', ['kill', container], { stdio: 'ignore' }).unref();
      }
      containers.clear();
    },
  };
}
