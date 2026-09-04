import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Type } from 'typebox';
import type { ModelRuntime as ModelRuntimeType } from '@earendil-works/pi-coding-agent';
import type { LocalContextState } from '../shared/local-context';
import { formatCurrentContext } from '../shared/local-context';
import type { CancelWorkResult, SendMessageResult, WorkEvent, WorkerReply, WorkJob } from '../shared/router';
import type { DelegationSelection } from '../shared/auth';
import type { TimelineDisplay, Worker } from '../shared/worker';
import type { PrimaryAgent, WorkerStop, WorkerUpdate } from '../shared/worker';
import { isActive } from '../shared/worker';
import type { WorkerFleet } from './workers';
import { vendorModuleUrl } from './vendor';
import { artifactOf, completeStop, detailOf, resultOf } from './agent-telemetry';
import { PRIMARY_AGENT_INSTRUCTIONS } from './primary-agent-instructions';
import { createFallbackResultDisplay, MAX_WIDGET_TEXT_LENGTH } from './result-display';

const MAX_CHILDREN_PER_JOB = 4;
const MAX_IMAGE_BYTES = 5_000_000;
const MAX_PRIMARY_TRACE = 12;
const PROGRESS_WAKE_DELAY_MS = 8_000;
const PROGRESS_WAKE_GAP_MS = 20_000;
const clock = () => new Date().toTimeString().slice(0, 5);
const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

type PiModule = typeof import('@earendil-works/pi-coding-agent');

export type WorkRouter = Awaited<ReturnType<typeof createWorkRouter>>;

export async function createWorkRouter(options: {
  sessionId: string;
  piSessionFile: string | null;
  piSessionDir: string;
  onPiSessionFile: (file: string) => void;
  initialPrimaryAgent: PrimaryAgent | null;
  emitPrimaryAgent: (agent: PrimaryAgent) => void;
  runtime: ModelRuntimeType;
  getSelection: () => DelegationSelection;
  getLocalContext: () => LocalContextState;
  getWorkspace: () => string | null;
  getNetworkEnabled: () => boolean;
  fleet: WorkerFleet;
  agentDir: string;
  emit: (event: WorkEvent) => void;
}) {
  const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PiModule>;
  const { createAgentSession, DefaultResourceLoader, defineTool, SessionManager } = await importEsm(vendorModuleUrl('@earendil-works/pi-coding-agent'));

  const jobs = new Map<string, WorkJob>();
  const displaysByWidgetId = new Map<string, TimelineDisplay>();
  const displayTitlesByJobId = new Map<string, string>();
  let activeJobId: string | null = null;
  let lastDisplayTitleInTurn: string | null = null;
  let mailbox = Promise.resolve();
  let closed = false;
  const lastProgressWakeAt = new Map<string, number>();
  let primaryAgent = options.initialPrimaryAgent;

  if (!primaryAgent) {
    primaryAgent = {
      sessionId: options.sessionId,
      name: 'PRIMARY',
      status: 'initializing',
      currentJobId: null,
      currentTask: null,
      startedAt: clock(),
      stops: [],
      updates: [],
      artifacts: [],
      piSessionId: 'pending',
      piSessionFile: null,
      error: null,
    };
    options.emitPrimaryAgent(primaryAgent);
  }

  const updatePrimary = (change: (agent: PrimaryAgent) => PrimaryAgent) => {
    if (!primaryAgent || closed) return;
    primaryAgent = change(primaryAgent);
    options.emitPrimaryAgent(primaryAgent);
  };

  const updateJob = (id: string, change: (job: WorkJob) => WorkJob) => {
    const current = jobs.get(id);
    if (!current) return null;
    const next = change(current);
    jobs.set(id, next);
    options.emit({ kind: 'job', sessionId: options.sessionId, job: next });
    return next;
  };

  const currentJob = () => {
    const job = activeJobId ? jobs.get(activeJobId) : null;
    if (!job) throw new Error('No active router job');
    if (job.status === 'cancelled' || job.status === 'complete' || job.status === 'failed') {
      throw new Error(`The active work job is already ${job.status}`);
    }
    return job;
  };

  const publish = (job: WorkJob, kind: WorkerReply['kind'], text: string, displayTitle: string | null = null) => {
    if (kind === 'result') {
      const activeChild = job.childWorkers.some((name) => {
        const worker = options.fleet.list().find((item) => item.name === name);
        return worker?.status === 'queued' || worker?.status === 'running';
      });
      if (activeChild) throw new Error('A definitive result cannot be published while required child work is active');
    }
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 4_000);
    if (!clean) throw new Error('Voice message text is required');
    const terminal = kind === 'result' || kind === 'error';
    const next = terminal
      ? updateJob(job.id, (item) => ({
          ...item,
          status: kind === 'result' ? 'complete' : 'failed',
          result: kind === 'result' ? clean : item.result,
          error: kind === 'error' ? clean : item.error,
        }))
      : job;
    let resolvedDisplayTitle = displayTitle ?? displayTitlesByJobId.get(job.id) ?? lastDisplayTitleInTurn;
    if (kind === 'result' && !resolvedDisplayTitle) {
      const display = createFallbackResultDisplay(job, clean);
      displayTitlesByJobId.set(job.id, display.title);
      resolvedDisplayTitle = display.title;
      options.emit({ kind: 'display', sessionId: options.sessionId, job: next ?? job, display });
    }
    const message: WorkerReply = {
      id: randomUUID(),
      jobId: job.id,
      kind,
      text: clean,
      displayTitle: resolvedDisplayTitle ?? null,
      createdAt: Date.now(),
    };
    options.emit({ kind: 'voice-message', sessionId: options.sessionId, message });
    return next;
  };

  const imageSource = async (input: string) => {
    if (/^https:\/\//i.test(input)) {
      if (!currentJob().networkEnabled) throw new Error('Network access is disabled for this work item');
      return input;
    }
    if (/^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(input)) return input;
    const workspace = options.getWorkspace();
    if (!workspace) throw new Error('No workspace is selected');
    const relativeInput = input.startsWith('/work/') ? input.slice('/work/'.length) : input;
    const absolute = resolve(workspace, relativeInput);
    const root = resolve(workspace);
    if (absolute !== root && !absolute.startsWith(`${root}/`)) throw new Error('Image files must be inside the shared workspace');
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(absolute)]);
    if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${sep}`)) {
      throw new Error('Image symlinks must remain inside the shared workspace');
    }
    const mime = IMAGE_MIME[extname(realFile).toLowerCase()];
    if (!mime) throw new Error('Image must be PNG, JPEG, WebP, or GIF');
    const metadata = await stat(realFile);
    if (metadata.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 5 MB widget limit');
    return `data:${mime};base64,${(await readFile(realFile)).toString('base64')}`;
  };

  const showDisplay = async (job: WorkJob, params: {
    title: string;
    widgetId?: string;
    format?: TimelineDisplay['format'];
    content: string;
    alt?: string;
    caption?: string;
    links?: readonly Readonly<{ label: string; url: string }>[];
  }) => {
    const format = params.format ?? 'markdown';
    const content = params.content.trim();
    if (format !== 'image' && content.length > MAX_WIDGET_TEXT_LENGTH) {
      throw new Error(`Text widgets must be at most ${MAX_WIDGET_TEXT_LENGTH} characters. Keep one takeaway and at most three short bullets.`);
    }
    const widgetId = params.widgetId?.trim() || null;
    const existing = widgetId ? displaysByWidgetId.get(`${job.id}:${widgetId}`) : null;
    const display: TimelineDisplay = {
      id: existing?.id ?? `${job.id}-${Date.now()}`,
      widgetId,
      title: params.title.trim().slice(0, 80),
      format,
      content: format === 'image' ? await imageSource(content) : content,
      alt: params.alt?.trim().slice(0, 300) || null,
      caption: params.caption?.trim().slice(0, 400) || null,
      links: (params.links ?? []).filter(({ url }) => /^https?:\/\//i.test(url)).slice(0, 3).map(({ label, url }) => ({
        label: label.trim().slice(0, 60),
        url: url.trim().slice(0, 2_000),
      })),
      createdAt: existing?.createdAt ?? Date.now(),
    };
    if (widgetId) displaysByWidgetId.set(`${job.id}:${widgetId}`, display);
    displayTitlesByJobId.set(job.id, display.title);
    lastDisplayTitleInTurn = display.title;
    options.emit({ kind: 'display', sessionId: options.sessionId, job, display });
    return display;
  };

  const dispatchTool = defineTool({
    name: 'dispatch_subagent',
    label: 'Dispatch Subagent',
    description: 'Start an isolated background task. Returns immediately.',
    parameters: Type.Object({
      task: Type.String({ minLength: 1, maxLength: 20_000, description: 'The background task and its relevant context.' }),
    }),
    execute: async (_id, params) => {
      const job = currentJob();
      if (job.childWorkers.length >= MAX_CHILDREN_PER_JOB) throw new Error(`A job may dispatch at most ${MAX_CHILDREN_PER_JOB} subagents`);
      const worker = options.fleet.dispatch(params.task.trim(), job.id, job.networkEnabled);
      updateJob(job.id, (item) => ({ ...item, status: 'working', childWorkers: [...item.childWorkers, worker.name] }));
      return {
        content: [{ type: 'text', text: `Background task ${worker.name} accepted. Milestones and the final report return automatically.` }],
        details: { worker: worker.name, status: 'accepted' },
      };
    },
  });

  const killSubagentsTool = defineTool({
    name: 'kill_subagents',
    label: 'Kill Subagents',
    description: 'Stop active subagents that are no longer needed. Omit workers to stop every active subagent.',
    parameters: Type.Object({
      workers: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
        maxItems: MAX_CHILDREN_PER_JOB,
        description: 'Optional worker callsigns to stop. Omit to stop all active subagents.',
      })),
    }),
    execute: async (_id, params) => {
      const job = currentJob();
      const requested = params.workers?.map((name) => name.trim().toUpperCase()).filter(Boolean);
      const requestedNames = requested?.length ? new Set(requested) : null;
      const childNames = new Set(job.childWorkers);
      const active = options.fleet.list().filter((worker) =>
        childNames.has(worker.name) && isActive(worker.status) && (!requestedNames || requestedNames.has(worker.name)));
      const stopped = active.filter((worker) => options.fleet.stop(worker.name).ok).map((worker) => worker.name);
      const missing = requestedNames
        ? [...requestedNames].filter((name) => !stopped.includes(name))
        : [];
      return {
        content: [{ type: 'text', text: stopped.length
          ? `Stopped ${stopped.join(', ')}.${missing.length ? ` Not active or unknown: ${missing.join(', ')}.` : ''}`
          : `No matching active subagents.${missing.length ? ` Not active or unknown: ${missing.join(', ')}.` : ''}` }],
        details: { stopped, missing },
      };
    },
  });

  const describeWorker = (worker: Worker) => {
    const latest = worker.updates.at(-1)?.text;
    const lastStop = worker.stops.at(-1);
    const lines = [`- ${worker.name}: ${worker.status}`];
    if (worker.status === 'complete') lines.push(`  result: ${worker.summary ?? '(no result)'}`);
    if (worker.status === 'failed' || worker.status === 'cancelled') lines.push(`  error: ${worker.error ?? worker.status}`);
    if (isActive(worker.status)) {
      if (latest) lines.push(`  latest: ${latest}`);
      if (lastStop) lines.push(`  last action: ${lastStop.tool}${lastStop.detail ? ` — ${lastStop.detail}` : ''} (${lastStop.status})`);
    }
    return lines.join('\n');
  };

  const sendMessageTool = defineTool({
    name: 'send_message',
    label: 'Send Message',
    description: 'Deliver a spoken message through Ambient.',
    parameters: Type.Object({
      message: Type.String({ minLength: 1, maxLength: 4_000 }),
    }),
    execute: async (_id, params) => {
      const job = currentJob();
      const hasActiveChildren = job.childWorkers.some((name) => {
        const worker = options.fleet.list().find((item) => item.name === name);
        return worker?.status === 'queued' || worker?.status === 'running';
      });
      publish(job, hasActiveChildren ? 'progress' : 'result', params.message);
      return { content: [{ type: 'text', text: 'Message sent.' }], details: { status: 'sent' } };
    },
  });

  const widgetTool = defineTool({
    name: 'show_widget',
    label: 'Show Widget',
    description: 'Show content on the timeline.',
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 80 }),
      widgetId: Type.Optional(Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-zA-Z0-9_-]+$' })),
      format: Type.Optional(Type.Union([Type.Literal('markdown'), Type.Literal('html'), Type.Literal('image')])),
      content: Type.String({ minLength: 1, maxLength: 7_000_000, description: 'Markdown, HTML, an HTTPS/data image URL, or a workspace-relative image path.' }),
      alt: Type.Optional(Type.String({ maxLength: 300 })),
      caption: Type.Optional(Type.String({ maxLength: 400 })),
      links: Type.Optional(Type.Array(Type.Object({
        label: Type.String({ minLength: 1, maxLength: 60 }),
        url: Type.String({ minLength: 8, maxLength: 2_000, pattern: '^https?://' }),
      }), { maxItems: 3 })),
    }),
    execute: async (_id, params) => {
      const job = currentJob();
      const display = await showDisplay(job, params);
      return { content: [{ type: 'text', text: `The ${display.format} widget “${display.title}” is on the timeline.` }], details: { id: display.id } };
    },
  });

  const selected = options.getSelection();
  const model = options.runtime.getModel(selected.provider, selected.model);
  if (!model) throw new Error(`Router model is not available: ${selected.provider}/${selected.model}`);
  const customTools = [dispatchTool, killSubagentsTool, sendMessageTool, widgetTool];
  const scratchCwd = resolve(options.agentDir, '..', 'router-workspace');
  await mkdir(scratchCwd, { recursive: true, mode: 0o700 });
  let routerCwd = options.getWorkspace() ?? scratchCwd;

  let piSessionFile = options.piSessionFile;

  const createSession = async (cwd: string, selectedModel = model, resume = false) => {
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: options.agentDir,
      noExtensions: true,
      systemPromptOverride: () => PRIMARY_AGENT_INSTRUCTIONS,
    });
    await resourceLoader.reload();
    const created = await createAgentSession({
      cwd,
      agentDir: options.agentDir,
      model: selectedModel,
      thinkingLevel: 'low',
      modelRuntime: options.runtime,
      tools: customTools.map((tool) => tool.name),
      customTools,
      resourceLoader,
      sessionManager: resume && piSessionFile && existsSync(piSessionFile)
        ? SessionManager.open(piSessionFile)
        : SessionManager.create(cwd, options.piSessionDir),
    });
    const file = created.session.sessionFile;
    created.session.agent.steeringMode = 'all';
    if (file) {
      piSessionFile = file;
      options.onPiSessionFile(file);
    }
    primaryAgent = {
      sessionId: options.sessionId,
      name: 'PRIMARY',
      status: 'idle',
      currentJobId: null,
      currentTask: null,
      startedAt: primaryAgent?.startedAt ?? clock(),
      stops: primaryAgent?.stops ?? [],
      updates: primaryAgent?.updates ?? [],
      artifacts: primaryAgent?.artifacts ?? [],
      piSessionId: created.session.sessionId,
      piSessionFile: file ?? null,
      error: null,
    };
    options.emitPrimaryAgent(primaryAgent);
    created.session.subscribe((event) => {
      if (event.type === 'agent_start') {
        const job = activeJobId ? jobs.get(activeJobId) : null;
        updatePrimary((agent) => ({
          ...agent,
          status: 'running',
          currentJobId: job?.id ?? null,
          currentTask: job?.request ?? null,
          error: null,
        }));
      } else if (event.type === 'tool_execution_start') {
        const stop: WorkerStop = {
          id: event.toolCallId,
          tool: event.toolName,
          detail: detailOf(event.args),
          status: 'running',
          result: null,
        };
        const artifact = artifactOf(event.toolName, event.args, options.getWorkspace());
        updatePrimary((agent) => ({
          ...agent,
          stops: [...agent.stops.filter(({ id }) => id !== stop.id), stop].slice(-MAX_PRIMARY_TRACE),
          artifacts: artifact && !agent.artifacts.some(({ path }) => path === artifact.path)
            ? [...agent.artifacts, artifact]
            : agent.artifacts,
        }));
      } else if (event.type === 'tool_execution_end') {
        updatePrimary((agent) => ({
          ...agent,
          stops: completeStop(agent.stops, event.toolCallId, resultOf(event.result), event.isError),
        }));
      } else if (event.type === 'message_end' && event.message.role === 'assistant' && 'stopReason' in event.message) {
        const message = event.message;
        const text = message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        const update: WorkerUpdate | null = text
          ? { at: clock(), text: text.length > 600 ? `${text.slice(0, 599)}...` : text }
          : null;
        updatePrimary((agent) => ({
          ...agent,
          updates: update ? [...agent.updates, update].slice(-MAX_PRIMARY_TRACE) : agent.updates,
          error: message.stopReason === 'error' || message.stopReason === 'aborted'
            ? message.errorMessage ?? message.stopReason
            : agent.error,
        }));
      } else if (event.type === 'agent_settled') {
        updatePrimary((agent) => ({ ...agent, status: 'idle', currentJobId: null, currentTask: null }));
      }
    });
    return created.session;
  };

  let session = await createSession(routerCwd, model, true);

  const enqueueTurn = (jobId: string, prompt: string) => {
    mailbox = mailbox.then(async () => {
      if (closed) return;
      const job = jobs.get(jobId);
      if (!job || job.status === 'cancelled' || job.status === 'complete' || job.status === 'failed') return;
      const firstTurn = job.status === 'accepted';
      const desiredCwd = options.getWorkspace() ?? scratchCwd;
      const anotherJobIsActive = [...jobs.values()].some((item) =>
        item.id !== jobId && (item.status === 'accepted' || item.status === 'routing' || item.status === 'working'),
      );
      if (firstTurn && desiredCwd !== routerCwd && !anotherJobIsActive) {
        session.dispose();
        const nextSelection = options.getSelection();
        const nextModel = options.runtime.getModel(nextSelection.provider, nextSelection.model);
        if (!nextModel) throw new Error(`Router model is not available: ${nextSelection.provider}/${nextSelection.model}`);
        session = await createSession(desiredCwd, nextModel);
        routerCwd = desiredCwd;
      }
      activeJobId = jobId;
      lastDisplayTitleInTurn = null;
      updateJob(jobId, (item) => ({ ...item, status: item.childWorkers.length ? 'working' : 'routing' }));
      try {
        const nextSelection = options.getSelection();
        if (session.model?.provider !== nextSelection.provider || session.model.id !== nextSelection.model) {
          const nextModel = options.runtime.getModel(nextSelection.provider, nextSelection.model);
          if (!nextModel) throw new Error(`Router model is not available: ${nextSelection.provider}/${nextSelection.model}`);
          await session.setModel(nextModel, { persist: false });
        }
        await session.prompt(prompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const current = jobs.get(jobId);
        if (current && current.status !== 'cancelled' && current.status !== 'complete' && current.status !== 'failed') {
          publish(current, 'error', `I couldn't complete that work: ${message}`);
        }
      } finally {
        activeJobId = null;
      }
    }).catch(() => {
      // Each turn handles its own failure; keep the mailbox alive.
    });
  };

  return {
    async sendMessage(request: string): Promise<SendMessageResult> {
      if (closed) throw new Error('This session is closed');
      const clean = request.trim();
      if (!clean) throw new Error('Message is required');
      const active = activeJobId ? jobs.get(activeJobId) : null;
      if (
        active &&
        session.isStreaming &&
        active.status !== 'complete' &&
        active.status !== 'failed' &&
        active.status !== 'cancelled'
      ) {
        await session.steer(`Event: user_steering\nUser message: ${clean}`);
        const revisedRequest = `${active.request}\n\nUser follow-up: ${clean}`;
        updateJob(active.id, (job) => ({ ...job, request: revisedRequest }));
        updatePrimary((agent) => agent.currentJobId === active.id
          ? { ...agent, currentTask: revisedRequest }
          : agent);
        return { messageId: active.id, status: 'sent' };
      }
      const id = randomUUID();
      const job: WorkJob = {
        id,
        request: clean,
        status: 'accepted',
        childWorkers: [],
        networkEnabled: options.getNetworkEnabled(),
        createdAt: Date.now(),
        result: null,
        error: null,
      };
      jobs.set(id, job);
      options.emit({ kind: 'job', sessionId: options.sessionId, job });
      enqueueTurn(id, [
        'Event: user_request',
        `Request ID: ${id}`,
        `User message: ${job.request}`,
        formatCurrentContext(options.getLocalContext()),
      ].join('\n\n'));
      return { messageId: id, status: 'sent' };
    },

    handleWorkerReport(worker: Worker) {
      if (closed) return;
      const job = jobs.get(worker.parentJobId);
      if (!job || job.status === 'cancelled' || job.status === 'complete' || job.status === 'failed') return;
      const siblings = job.childWorkers.map((name) => options.fleet.list().find((item) => item.name === name)).filter(Boolean) as Worker[];
      enqueueTurn(job.id, [
        'Event: subagent_report',
        `Job ID: ${job.id}`,
        `Subagent: ${worker.name}`,
        `Original user request: ${job.request}`,
        `Assigned task: ${worker.task}`,
        `Status: ${worker.status}`,
        worker.status === 'complete' ? `Result: ${worker.summary ?? '(no result)'}` : `Error: ${worker.error ?? worker.status}`,
        'Current children:',
        ...siblings.map(describeWorker),
      ].join('\n'));
    },

    handleWorkerProgress(worker: Worker) {
      if (closed) return;
      const job = jobs.get(worker.parentJobId);
      if (!job || job.status === 'cancelled' || job.status === 'complete' || job.status === 'failed') return;
      const now = Date.now();
      const lastWake = lastProgressWakeAt.get(job.id);
      if (now - job.createdAt < PROGRESS_WAKE_DELAY_MS || (lastWake && now - lastWake < PROGRESS_WAKE_GAP_MS)) return;
      lastProgressWakeAt.set(job.id, now);
      enqueueTurn(job.id, [
        'Event: subagent_milestone',
        `Job ID: ${job.id}`,
        `Subagent: ${worker.name}`,
        `Milestone: ${worker.updates.at(-1)?.text ?? 'Work is continuing.'}`,
        `Original user request: ${job.request}`,
      ].join('\n\n'));
    },

    list: (): readonly WorkJob[] => [...jobs.values()],

    hasActive: () => [...jobs.values()].some((job) =>
      job.status === 'accepted' || job.status === 'routing' || job.status === 'working'),

    cancel(id: string): CancelWorkResult {
      const job = jobs.get(id);
      if (!job) return { ok: false, error: `Unknown work job ${id}` };
      if (job.status === 'complete' || job.status === 'failed' || job.status === 'cancelled') {
        return { ok: false, error: `Work job is already ${job.status}` };
      }
      for (const worker of job.childWorkers) options.fleet.stop(worker);
      updateJob(id, (item) => ({ ...item, status: 'cancelled' }));
      if (activeJobId === id) {
        session.clearQueue();
        void session.abort();
      }
      options.emit({
        kind: 'voice-message',
        sessionId: options.sessionId,
        message: { id: randomUUID(), jobId: id, kind: 'error', text: 'Stopped.', displayTitle: null, createdAt: Date.now() },
      });
      return { ok: true, jobId: id, status: 'cancelled' };
    },

    shutdown() {
      closed = true;
      session.dispose();
    },
  };
}
