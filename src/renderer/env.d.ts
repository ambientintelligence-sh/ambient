import type { Worker, WorkerEvent } from '@/shared/worker';

declare global {
  interface Window {
    /** Absent when the renderer is opened in a plain browser for design work. */
    ambient?: {
      setupUrl: string;
      dispatchWorker: (task: string) => Promise<Worker>;
      listWorkers: () => Promise<Worker[]>;
      onWorkerEvent: (listener: (event: WorkerEvent) => void) => () => void;
    };
  }
}

export {};
