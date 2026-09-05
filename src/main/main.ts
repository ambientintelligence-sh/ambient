import { app, BrowserWindow, ipcMain, shell, systemPreferences } from 'electron';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createAuthService, type AuthService } from './auth-service';
import { createBrowserService } from './browser';
import { createLocalContextService, type LocalContextService } from './local-context';
import { openDatabase } from './db';
import { createSessionRepository, type SessionRecord, type SessionRepository } from './db/session-repository';
import { createWorkRouter, type WorkRouter } from './router';
import { startTokenServer } from './token-server';
import { createWorkerFleet, type WorkerFleet } from './workers';
import { vendorNodeModules } from './vendor';
import { createWorkspaceService, type WorkspaceService } from './workspace';
import type { AuthEvent, AuthMethod, DelegationSelection } from '../shared/auth';
import type { BrowserMode } from '../shared/browser';
import { WORKER_MODEL_ID } from '../shared/config';
import type { LocalContextUpdate } from '../shared/local-context';
import type { NetworkState } from '../shared/sandbox';
import type { SessionEvent } from '../shared/session';

loadEnv({ path: path.join(app.getAppPath(), '../../.env'), quiet: true });
loadEnv({ quiet: true });

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (app.isPackaged) {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) app.quit();

  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}

let fleet: WorkerFleet | null = null;
let auth: AuthService | null = null;
let workspace: WorkspaceService | null = null;
let browser: Awaited<ReturnType<typeof createBrowserService>> | null = null;
let localContext: LocalContextService | null = null;
let router: WorkRouter | null = null;
let tempRoot: string | null = null;
let sessionRepository: SessionRepository | null = null;
let activeSession: SessionRecord | null = null;
let closeDatabase: (() => void) | null = null;
let switchingSession = false;
// The next-job network toggle. Defaults ON on every launch; captured by each
// top-level job at dispatch time, so flipping it never alters running work.
let networkEnabled = true;

const emitAuth = (event: AuthEvent) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('auth:event', event);
};

const emitSession = (event: SessionEvent) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('session:event', event);
};

async function createSessionServices() {
  if (!auth || !workspace || !browser || !localContext || !tempRoot || !sessionRepository || !activeSession) {
    throw new Error('application services are not ready');
  }
  const sessionId = activeSession.id;
  let sessionRouter: WorkRouter | null = null;
  const chromeMcpPath = path.join(vendorNodeModules(), 'chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js');
  fleet = createWorkerFleet({
    sessionId,
    getSelection: auth.currentSelection,
    onReport: (worker) => sessionRouter?.handleWorkerReport(worker),
    getWorkspace: workspace.getPath,
    getBrowserConfig: browser.workerConfig,
    getLocalContext: localContext.state,
    agentDir: auth.agentDir,
    tempRoot,
    subagentEntryPath: path.join(__dirname, 'subagent.js'),
    chromeMcpPath,
    sessionDir: path.join(auth.agentDir, 'ambient-subagent-sessions', sessionId),
    emit: (event) => {
      sessionRepository?.saveWorker(event.sessionId, event.worker);
      for (const target of BrowserWindow.getAllWindows()) target.webContents.send('worker:event', event);
    },
  });
  sessionRouter = await createWorkRouter({
    sessionId,
    piSessionFile: activeSession.piSessionFile,
    piSessionDir: path.join(auth.agentDir, 'ambient-sessions'),
    onPiSessionFile: (file) => {
      sessionRepository?.setPiSessionFile(sessionId, file);
      if (activeSession?.id === sessionId) activeSession = { ...activeSession, piSessionFile: file };
    },
    initialPrimaryAgent: sessionRepository.snapshot(sessionId).primaryAgent,
    emitPrimaryAgent: (agent) => {
      sessionRepository?.savePrimaryAgent(agent);
      for (const target of BrowserWindow.getAllWindows()) {
        target.webContents.send('primary-agent:event', { sessionId, agent });
      }
    },
    runtime: auth.runtime,
    getSelection: auth.currentSelection,
    getLocalContext: localContext.state,
    getWorkspace: workspace.getPath,
    getNetworkEnabled: () => networkEnabled,
    fleet,
    agentDir: auth.agentDir,
    emit: (event) => {
      if (event.kind === 'job') sessionRepository?.saveJob(event.sessionId, event.job);
      else if (event.kind === 'voice-message') sessionRepository?.saveReply(event.sessionId, event.message);
      else if (event.kind === 'display-removed') sessionRepository?.dismissDisplay(event.sessionId, event.displayId);
      else sessionRepository?.saveDisplay(event.sessionId, event.job.id, event.display);
      for (const target of BrowserWindow.getAllWindows()) target.webContents.send('work:event', event);
    },
  });
  router = sessionRouter;
}

async function switchSession(next: SessionRecord, interruptActive = false) {
  if (switchingSession) throw new Error('A session change is already in progress');
  if (router?.hasActive() && !interruptActive) throw new Error('Wait for active work to finish before changing sessions');
  switchingSession = true;
  const previous = activeSession;
  try {
    if (previous && previous.id !== next.id) {
      sessionRepository?.reconcileInterrupted(previous.id, 'Interrupted when the voice session ended.');
    }
    router?.shutdown();
    fleet?.shutdown();
    router = null;
    fleet = null;
    sessionRepository?.reconcileInterrupted(next.id);
    activeSession = sessionRepository?.getSession(next.id) ?? next;
    await createSessionServices();
    const snapshot = sessionRepository!.snapshot(next.id);
    emitSession({ kind: 'selected', snapshot });
    return snapshot;
  } catch (cause) {
    router?.shutdown();
    fleet?.shutdown();
    router = null;
    fleet = null;
    activeSession = previous;
    if (previous) await createSessionServices();
    throw cause;
  } finally {
    switchingSession = false;
  }
}

async function createWindow(setupUrl: string) {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#101116',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--realtime-setup-url=${setupUrl}`],
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!router || !fleet) await createSessionServices();

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

app.whenReady().then(async () => {
  const agentDir = path.join(app.getPath('userData'), 'pi-agent');
  const configuredLocation = process.env.EXA_USER_LOCATION?.trim().toUpperCase();
  const localeLocation = app.getLocaleCountryCode().trim().toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(configuredLocation ?? '')
    ? configuredLocation!
    : /^[A-Z]{2}$/.test(localeLocation)
      ? localeLocation
      : null;
  auth = await createAuthService({
    agentDir,
    fallback: {
      provider: process.env.PI_WORKER_PROVIDER ?? 'openai',
      model: process.env.PI_WORKER_MODEL ?? WORKER_MODEL_ID,
    },
    emit: emitAuth,
    openExternal: (url) => {
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    },
  });
  workspace = await createWorkspaceService(app.getPath('userData'));
  browser = await createBrowserService(app.getPath('userData'));
  localContext = await createLocalContextService(app.getPath('userData'), countryCode);
  const database = openDatabase(
    path.join(agentDir, 'ambient.sqlite'),
    path.join(app.getAppPath(), 'drizzle'),
  );
  closeDatabase = database.close;
  sessionRepository = createSessionRepository(database.db);
  activeSession = sessionRepository.latestOrCreate(workspace.getPath());
  sessionRepository.reconcileInterrupted(activeSession.id);
  activeSession = sessionRepository.getSession(activeSession.id);
  // Private per-task temp dirs. Wipe leftovers from any previous run.
  tempRoot = path.join(app.getPath('userData'), 'agent-tmp');
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });

  ipcMain.handle('worker:message', (_event, message: string) => router?.sendMessage(message) ?? null);
  ipcMain.handle('session:current', () => {
    if (!sessionRepository || !activeSession) throw new Error('Session storage is unavailable');
    return sessionRepository.snapshot(activeSession.id);
  });
  ipcMain.handle('session:list', () => sessionRepository?.list() ?? []);
  ipcMain.handle('session:create', () => {
    if (!sessionRepository) throw new Error('Session storage is unavailable');
    if (switchingSession) throw new Error('A session change is already in progress');
    return switchSession(sessionRepository.createSession(workspace?.getPath() ?? null), true);
  });
  ipcMain.handle('session:select', (_event, id: string) => {
    const next = sessionRepository?.getSession(id);
    if (!next) throw new Error(`Unknown session ${id}`);
    if (activeSession?.id === next.id) return sessionRepository!.snapshot(next.id);
    return switchSession(next);
  });
  ipcMain.handle('session:dismiss-display', (_event, id: string) => {
    if (!sessionRepository || !activeSession) throw new Error('Session storage is unavailable');
    sessionRepository.dismissDisplay(activeSession.id, id);
    emitSession({ kind: 'display-dismissed', displayId: id });
  });
  ipcMain.handle('network:state', (): NetworkState => ({ enabled: networkEnabled }));
  ipcMain.handle('network:set', (_event, enabled: boolean): NetworkState => {
    networkEnabled = enabled === true;
    const state: NetworkState = { enabled: networkEnabled };
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('network:event', state);
    return state;
  });
  ipcMain.handle('workspace:state', () => workspace?.state());
  ipcMain.handle('workspace:select', async (event) => {
    const state = await workspace?.select(BrowserWindow.fromWebContents(event.sender) ?? undefined);
    if (state) {
      if (activeSession) {
        sessionRepository?.setWorkspace(activeSession.id, state.path);
        activeSession = { ...activeSession, workspace: state.path, updatedAt: Date.now() };
      }
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('workspace:event', state);
    }
    return state;
  });
  ipcMain.handle('workspace:open', () => workspace?.open());
  ipcMain.handle('browser:state', () => browser?.state());
  ipcMain.handle('browser:set-mode', (_event, mode: BrowserMode) => browser?.setMode(mode));
  ipcMain.handle('location:state', () => localContext?.state());
  ipcMain.handle('location:set', async (_event, input: LocalContextUpdate) => {
    const state = await localContext?.set(input);
    if (state) {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('location:event', state);
    }
    return state;
  });
  ipcMain.handle('location:clear', async () => {
    const state = await localContext?.clear();
    if (state) {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('location:event', state);
    }
    return state;
  });
  ipcMain.handle('auth:state', () => auth?.state());
  ipcMain.handle('auth:login', (_event, providerId: string, method: AuthMethod) => auth?.login(providerId, method));
  ipcMain.handle('auth:answer', (_event, promptId: string, value: string) => auth?.answer(promptId, value));
  ipcMain.handle('auth:cancel', () => auth?.cancel());
  ipcMain.handle('auth:logout', (_event, providerId: string) => auth?.logout(providerId));
  ipcMain.handle('auth:select', (_event, selection: DelegationSelection) => auth?.select(selection));
  ipcMain.handle('auth:open-url', (_event, url: string) => {
    if (url.startsWith('https://') || url.startsWith('http://')) return shell.openExternal(url);
  });

  await systemPreferences.askForMediaAccess('microphone');
  const { url } = await startTokenServer(process.env.OPENAI_API_KEY);
  await createWindow(url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on('before-quit', () => {
  router?.shutdown();
  fleet?.shutdown();
  browser?.shutdown();
});

app.on('will-quit', () => closeDatabase?.());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
