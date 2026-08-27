export type WorkerStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type WorkerStop = Readonly<{
  id: string;
  tool: string;
  detail: string;
  status: 'running' | 'done' | 'error';
  result: string | null;
}>;

export type WorkerUpdate = Readonly<{ at: string; text: string }>;

export type Worker = Readonly<{
  name: string;
  task: string;
  status: WorkerStatus;
  /** Dispatch time, HH:MM. */
  startedAt: string;
  stops: readonly WorkerStop[];
  updates: readonly WorkerUpdate[];
  summary: string | null;
  error: string | null;
}>;

/**
 * `progress` is a five-second heartbeat suitable for a short spoken summary.
 * `report` is terminal — it carries the worker's actual result.
 */
export type WorkerEvent =
  | { kind: 'update'; worker: Worker }
  | { kind: 'progress'; worker: Worker; summary: string }
  | { kind: 'report'; worker: Worker };

export type WorkerSteerResult =
  | Readonly<{ ok: true; worker: string; status: 'steering queued' }>
  | Readonly<{ ok: false; error: string }>;

export type WorkerStopResult =
  | Readonly<{ ok: true; worker: string; status: 'stopped' }>
  | Readonly<{ ok: false; error: string }>;

export const isTerminal = (status: WorkerStatus) =>
  status === 'done' || status === 'failed' || status === 'cancelled';
