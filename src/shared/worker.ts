export type WorkerStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';

export type WorkerStop = Readonly<{
  id: string;
  tool: string;
  detail: string;
  status: 'running' | 'done' | 'error';
  result: string | null;
}>;

export type WorkerUpdate = Readonly<{ at: string; text: string }>;

export type AgentArtifact = Readonly<{
  path: string;
  tool: string;
}>;

export type TimelineDisplay = Readonly<{
  id: string;
  widgetId: string | null;
  title: string;
  format: 'html' | 'markdown' | 'image';
  content: string;
  alt: string | null;
  caption: string | null;
  links: readonly Readonly<{ label: string; url: string }>[];
  createdAt: number;
}>;

export type Worker = Readonly<{
  name: string;
  task: string;
  parentJobId: string;
  status: WorkerStatus;
  /** Dispatch time, HH:MM. */
  startedAt: string;
  stops: readonly WorkerStop[];
  updates: readonly WorkerUpdate[];
  artifacts: readonly AgentArtifact[];
  piSessionId: string | null;
  piSessionFile: string | null;
  summary: string | null;
  error: string | null;
}>;

export type WorkerEvent =
  | { kind: 'update'; sessionId: string; worker: Worker }
  | { kind: 'report'; sessionId: string; worker: Worker };

export type PrimaryAgentStatus = 'initializing' | 'idle' | 'running';

export type PrimaryAgent = Readonly<{
  sessionId: string;
  name: 'PRIMARY';
  status: PrimaryAgentStatus;
  currentJobId: string | null;
  currentTask: string | null;
  startedAt: string;
  stops: readonly WorkerStop[];
  updates: readonly WorkerUpdate[];
  artifacts: readonly AgentArtifact[];
  piSessionId: string;
  piSessionFile: string | null;
  error: string | null;
}>;

export type PrimaryAgentEvent = Readonly<{
  sessionId: string;
  agent: PrimaryAgent;
}>;

export const isTerminal = (status: WorkerStatus) => status === 'complete' || status === 'failed' || status === 'cancelled';

export const isActive = (status: WorkerStatus) => status === 'queued' || status === 'running';
