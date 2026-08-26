import type { AuthEvent, AuthMethod, AuthState, DelegationSelection } from '@/shared/auth';
import type { Worker, WorkerEvent } from '@/shared/worker';

declare global {
  interface Window {
    /** Absent when the renderer is opened in a plain browser for design work. */
    ambient?: {
      setupUrl: string;
      dispatchWorker: (task: string) => Promise<Worker>;
      listWorkers: () => Promise<Worker[]>;
      getAuthState: () => Promise<AuthState>;
      login: (providerId: string, method: AuthMethod) => Promise<AuthState>;
      answerLogin: (promptId: string, value: string) => Promise<void>;
      cancelLogin: () => Promise<void>;
      logout: (providerId: string) => Promise<AuthState>;
      selectDelegationModel: (selection: DelegationSelection) => Promise<AuthState>;
      openExternal: (url: string) => Promise<void>;
      onAuthEvent: (listener: (event: AuthEvent) => void) => () => void;
      onWorkerEvent: (listener: (event: WorkerEvent) => void) => () => void;
    };
  }
}

export {};
