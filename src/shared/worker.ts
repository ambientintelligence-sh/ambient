export type WorkerStatus = 'queued' | 'running' | 'idle' | 'failed' | 'cancelled';

export type WorkerStop = Readonly<{
  id: string;
  tool: string;
  detail: string;
  status: 'running' | 'done' | 'error';
  result: string | null;
}>;

export type WorkerUpdate = Readonly<{ at: string; text: string }>;

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
  summary: string | null;
  error: string | null;
}>;

export type WorkerEvent =
  | { kind: 'update'; worker: Worker }
  | { kind: 'report'; worker: Worker };

export const isTerminal = (status: WorkerStatus) => status === 'failed' || status === 'cancelled';

export const isActive = (status: WorkerStatus) => status === 'queued' || status === 'running';
