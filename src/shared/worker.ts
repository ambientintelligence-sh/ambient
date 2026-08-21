export type WorkerStatus = 'queued' | 'running' | 'done' | 'failed';

export type WorkerStop = Readonly<{ tool: string; detail: string }>;

export type Worker = Readonly<{
  name: string;
  task: string;
  status: WorkerStatus;
  /** Dispatch time, HH:MM. */
  startedAt: string;
  stops: readonly WorkerStop[];
  summary: string | null;
  error: string | null;
}>;

/**
 * `report` is terminal — it is the cue to tell the user out loud what came back.
 */
export type WorkerEvent =
  | { kind: 'update'; worker: Worker }
  | { kind: 'report'; worker: Worker };

export const isTerminal = (status: WorkerStatus) => status === 'done' || status === 'failed';
