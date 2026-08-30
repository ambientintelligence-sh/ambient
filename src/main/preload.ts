import { contextBridge, ipcRenderer } from 'electron';
import type { AuthEvent, AuthMethod, AuthState, DelegationSelection } from '../shared/auth';
import type { BrowserMode, BrowserState } from '../shared/browser';
import type { LocalContextState, LocalContextUpdate } from '../shared/local-context';
import type { Worker, WorkerEvent, WorkerSteerResult, WorkerStopResult } from '../shared/worker';
import type { WorkspaceState } from '../shared/workspace';

const flag = '--realtime-setup-url=';
const setupUrl = process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length) ?? '';

contextBridge.exposeInMainWorld('ambient', {
  setupUrl,
  dispatchWorker: (task: string): Promise<Worker> => ipcRenderer.invoke('worker:dispatch', task),
  steerWorker: (name: string, instruction: string): Promise<WorkerSteerResult> =>
    ipcRenderer.invoke('worker:steer', name, instruction),
  stopWorker: (name: string): Promise<WorkerStopResult> => ipcRenderer.invoke('worker:stop', name),
  listWorkers: (): Promise<Worker[]> => ipcRenderer.invoke('worker:list'),
  getWorkspace: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:state'),
  selectWorkspace: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:select'),
  openWorkspace: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:open'),
  getBrowserState: (): Promise<BrowserState> => ipcRenderer.invoke('browser:state'),
  setBrowserMode: (mode: BrowserMode): Promise<BrowserState> => ipcRenderer.invoke('browser:set-mode', mode),
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
  selectSummaryModel: (selection: DelegationSelection): Promise<AuthState> => ipcRenderer.invoke('auth:select-summary', selection),
  selectAdvisorModel: (selection: DelegationSelection): Promise<AuthState> => ipcRenderer.invoke('auth:select-advisor', selection),
  askAdvisor: (question: string, context?: string): Promise<string> => ipcRenderer.invoke('advisor:ask', question, context),
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
});
