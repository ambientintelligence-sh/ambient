export type WorkerStatus = 'queued' | 'running' | 'idle' | 'failed' | 'cancelled';

export type WorkerStop = Readonly<{
  id: string;
  tool: string;
  detail: string;
  status: 'running' | 'done' | 'error';
  result: string | null;
}>;

export type WorkerUpdate = Readonly<{ at: string; text: string }>;

export type WorkerDisplay = Readonly<{
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
  status: WorkerStatus;
  /** Dispatch time, HH:MM. */
  startedAt: string;
  stops: readonly WorkerStop[];
  updates: readonly WorkerUpdate[];
  displays: readonly WorkerDisplay[];
  summary: string | null;
  error: string | null;
}>;

/**
 * Progress is one fleet-wide digest, never one notification per worker.
 * `report` is authoritative — it carries a worker's checkpoint or failure.
 */
export type WorkerEvent =
  | { kind: 'update'; worker: Worker }
  | { kind: 'fleet-progress'; workers: readonly Worker[]; summary: string }
  | { kind: 'report'; worker: Worker };

export type WorkerSteerResult =
  | Readonly<{ ok: true; worker: string; status: 'steering queued' }>
  | Readonly<{ ok: false; error: string }>;

export type WorkerStopResult =
  | Readonly<{ ok: true; worker: string; status: 'stopped' }>
  | Readonly<{ ok: false; error: string }>;

export const isTerminal = (status: WorkerStatus) => status === 'failed' || status === 'cancelled';

export const isActive = (status: WorkerStatus) => status === 'queued' || status === 'running';
