import { contextBridge, ipcRenderer } from 'electron';
import type { AuthEvent, AuthMethod, AuthState, DelegationSelection } from '../shared/auth';
import type { BrowserMode, BrowserState } from '../shared/browser';
import type { LocalContextState, LocalContextUpdate } from '../shared/local-context';
import type { SendMessageResult, WorkEvent } from '../shared/router';
import type { NetworkState } from '../shared/sandbox';
import type { SessionEvent, SessionSnapshot, SessionSummary } from '../shared/session';
import type { PrimaryAgentEvent, WorkerEvent } from '../shared/worker';
import type { WorkspaceState } from '../shared/workspace';

const flag = '--realtime-setup-url=';
const setupUrl = process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length) ?? '';

contextBridge.exposeInMainWorld('ambient', {
  setupUrl,
  sendMessage: (message: string): Promise<SendMessageResult> => ipcRenderer.invoke('worker:message', message),
  getSession: (): Promise<SessionSnapshot> => ipcRenderer.invoke('session:current'),
  listSessions: (): Promise<readonly SessionSummary[]> => ipcRenderer.invoke('session:list'),
  createSession: (): Promise<SessionSnapshot> => ipcRenderer.invoke('session:create'),
  selectSession: (id: string): Promise<SessionSnapshot> => ipcRenderer.invoke('session:select', id),
  dismissDisplay: (id: string): Promise<void> => ipcRenderer.invoke('session:dismiss-display', id),
  onSessionEvent: (listener: (event: SessionEvent) => void) => {
    const handler = (_: unknown, event: SessionEvent) => listener(event);
    ipcRenderer.on('session:event', handler);
    return () => ipcRenderer.off('session:event', handler);
  },
  getWorkspace: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:state'),
  selectWorkspace: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:select'),
  openWorkspace: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:open'),
  getBrowserState: (): Promise<BrowserState> => ipcRenderer.invoke('browser:state'),
  setBrowserMode: (mode: BrowserMode): Promise<BrowserState> => ipcRenderer.invoke('browser:set-mode', mode),
  getNetworkState: (): Promise<NetworkState> => ipcRenderer.invoke('network:state'),
  setNetworkEnabled: (enabled: boolean): Promise<NetworkState> => ipcRenderer.invoke('network:set', enabled),
  onNetworkChanged: (listener: (state: NetworkState) => void) => {
    const handler = (_: unknown, state: NetworkState) => listener(state);
    ipcRenderer.on('network:event', handler);
    return () => ipcRenderer.off('network:event', handler);
  },
  getLocationState: (): Promise<LocalContextState> => ipcRenderer.invoke('location:state'),
  setLocation: (input: LocalContextUpdate): Promise<LocalContextState> => ipcRenderer.invoke('location:set', input),
  clearLocation: (): Promise<LocalContextState> => ipcRenderer.invoke('location:clear'),
  onLocationChanged: (listener: (state: LocalContextState) => void) => {
    const handler = (_: unknown, state: LocalContextState) => listener(state);
    ipcRenderer.on('location:event', handler);
    return () => ipcRenderer.off('location:event', handler);
  },
  onWorkspaceChanged: (listener: (state: WorkspaceState) => void) => {
    const handler = (_: unknown, state: WorkspaceState) => listener(state);
    ipcRenderer.on('workspace:event', handler);
    return () => ipcRenderer.off('workspace:event', handler);
  },
  getAuthState: (): Promise<AuthState> => ipcRenderer.invoke('auth:state'),
  login: (providerId: string, method: AuthMethod): Promise<AuthState> => ipcRenderer.invoke('auth:login', providerId, method),
  answerLogin: (promptId: string, value: string): Promise<void> => ipcRenderer.invoke('auth:answer', promptId, value),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke('auth:cancel'),
  logout: (providerId: string): Promise<AuthState> => ipcRenderer.invoke('auth:logout', providerId),
  selectDelegationModel: (selection: DelegationSelection): Promise<AuthState> => ipcRenderer.invoke('auth:select', selection),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('auth:open-url', url),
  onAuthEvent: (listener: (event: AuthEvent) => void) => {
    const handler = (_: unknown, event: AuthEvent) => listener(event);
    ipcRenderer.on('auth:event', handler);
    return () => ipcRenderer.off('auth:event', handler);
  },
  onWorkerEvent: (listener: (event: WorkerEvent) => void) => {
    const handler = (_: unknown, event: WorkerEvent) => listener(event);
    ipcRenderer.on('worker:event', handler);
    return () => ipcRenderer.off('worker:event', handler);
  },
  onPrimaryAgentEvent: (listener: (event: PrimaryAgentEvent) => void) => {
    const handler = (_: unknown, event: PrimaryAgentEvent) => listener(event);
    ipcRenderer.on('primary-agent:event', handler);
    return () => ipcRenderer.off('primary-agent:event', handler);
  },
  onWorkEvent: (listener: (event: WorkEvent) => void) => {
    const handler = (_: unknown, event: WorkEvent) => listener(event);
    ipcRenderer.on('work:event', handler);
    return () => ipcRenderer.off('work:event', handler);
  },
});
