import type { AuthEvent, AuthMethod, AuthState, DelegationSelection } from '@/shared/auth';
import type { BrowserMode, BrowserState } from '@/shared/browser';
import type { LocalContextState, LocalContextUpdate } from '@/shared/local-context';
import type { Worker, WorkerEvent, WorkerSteerResult, WorkerStopResult } from '@/shared/worker';
import type { WorkspaceState } from '@/shared/workspace';

declare global {
  interface Window {
    /** Absent when the renderer is opened in a plain browser for design work. */
    ambient?: {
      setupUrl: string;
      dispatchWorker: (task: string) => Promise<Worker>;
      steerWorker: (name: string, instruction: string) => Promise<WorkerSteerResult>;
      stopWorker: (name: string) => Promise<WorkerStopResult>;
      listWorkers: () => Promise<Worker[]>;
      getWorkspace: () => Promise<WorkspaceState>;
      selectWorkspace: () => Promise<WorkspaceState>;
      openWorkspace: () => Promise<WorkspaceState>;
      onWorkspaceChanged: (listener: (state: WorkspaceState) => void) => () => void;
      getBrowserState: () => Promise<BrowserState>;
      setBrowserMode: (mode: BrowserMode) => Promise<BrowserState>;
      getLocationState: () => Promise<LocalContextState>;
      setLocation: (input: LocalContextUpdate) => Promise<LocalContextState>;
      clearLocation: () => Promise<LocalContextState>;
      onLocationChanged: (listener: (state: LocalContextState) => void) => () => void;
      getAuthState: () => Promise<AuthState>;
      login: (providerId: string, method: AuthMethod) => Promise<AuthState>;
      answerLogin: (promptId: string, value: string) => Promise<void>;
      cancelLogin: () => Promise<void>;
      logout: (providerId: string) => Promise<AuthState>;
      selectDelegationModel: (selection: DelegationSelection) => Promise<AuthState>;
      selectSummaryModel: (selection: DelegationSelection) => Promise<AuthState>;
      selectAdvisorModel: (selection: DelegationSelection) => Promise<AuthState>;
      askAdvisor: (question: string, context?: string) => Promise<string>;
      openExternal: (url: string) => Promise<void>;
      onAuthEvent: (listener: (event: AuthEvent) => void) => () => void;
      onWorkerEvent: (listener: (event: WorkerEvent) => void) => () => void;
    };
  }
}

export {};
