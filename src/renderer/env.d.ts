import type { AuthEvent, AuthMethod, AuthState, DelegationSelection } from '@/shared/auth';
import type { BrowserMode, BrowserState } from '@/shared/browser';
import type { LocalContextState, LocalContextUpdate } from '@/shared/local-context';
import type { SendMessageResult, WorkEvent } from '@/shared/router';
import type { NetworkState } from '@/shared/sandbox';
import type { SessionEvent, SessionSnapshot, SessionSummary } from '@/shared/session';
import type { PrimaryAgentEvent, WorkerEvent } from '@/shared/worker';
import type { WorkspaceState } from '@/shared/workspace';

declare global {
  interface Window {
    /** Absent when the renderer is opened in a plain browser for design work. */
    ambient?: {
      setupUrl: string;
      sendMessage: (message: string) => Promise<SendMessageResult>;
      getSession: () => Promise<SessionSnapshot>;
      listSessions: () => Promise<readonly SessionSummary[]>;
      createSession: () => Promise<SessionSnapshot>;
      selectSession: (id: string) => Promise<SessionSnapshot>;
      dismissDisplay: (id: string) => Promise<void>;
      onSessionEvent: (listener: (event: SessionEvent) => void) => () => void;
      getWorkspace: () => Promise<WorkspaceState>;
      selectWorkspace: () => Promise<WorkspaceState>;
      openWorkspace: () => Promise<WorkspaceState>;
      onWorkspaceChanged: (listener: (state: WorkspaceState) => void) => () => void;
      getBrowserState: () => Promise<BrowserState>;
      setBrowserMode: (mode: BrowserMode) => Promise<BrowserState>;
      getNetworkState: () => Promise<NetworkState>;
      setNetworkEnabled: (enabled: boolean) => Promise<NetworkState>;
      onNetworkChanged: (listener: (state: NetworkState) => void) => () => void;
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
      openExternal: (url: string) => Promise<void>;
      onAuthEvent: (listener: (event: AuthEvent) => void) => () => void;
      onWorkerEvent: (listener: (event: WorkerEvent) => void) => () => void;
      onPrimaryAgentEvent: (listener: (event: PrimaryAgentEvent) => void) => () => void;
      onWorkEvent: (listener: (event: WorkEvent) => void) => () => void;
    };
  }
}

export {};
