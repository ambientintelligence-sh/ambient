import { app, BrowserWindow, ipcMain, shell, systemPreferences } from 'electron';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createAuthService, type AuthService } from './auth-service';
import { createBrowserService } from './browser';
import { ensureWorkerImage } from './docker';
import { createLocalContextService, type LocalContextService } from './local-context';
import { createWorkRouter, type WorkRouter } from './router';
import { startTokenServer } from './token-server';
import { createWorkerFleet, type WorkerFleet } from './workers';
import { createWorkspaceService, type WorkspaceService } from './workspace';
import type { AuthEvent, AuthMethod, DelegationSelection } from '../shared/auth';
import type { BrowserMode } from '../shared/browser';
import { WORKER_MODEL_ID } from '../shared/config';
import type { LocalContextUpdate } from '../shared/local-context';

loadEnv({ path: path.join(app.getAppPath(), '../../.env'), quiet: true });
loadEnv({ quiet: true });

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

let fleet: WorkerFleet | null = null;
let auth: AuthService | null = null;
let workspace: WorkspaceService | null = null;
let browser: Awaited<ReturnType<typeof createBrowserService>> | null = null;
let localContext: LocalContextService | null = null;
let router: WorkRouter | null = null;

const emitAuth = (event: AuthEvent) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('auth:event', event);
};

async function createWindow(setupUrl: string) {
  const window = new BrowserWindow({
    width: 430,
    height: 820,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#000000',
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

  if (!auth || !workspace || !browser || !localContext) throw new Error('application services are not ready');

  fleet ??= createWorkerFleet({
    getSelection: auth.currentSelection,
    onReport: (worker) => router?.handleWorkerReport(worker),
    getWorkspace: workspace.getPath,
    getBrowserConfig: browser.workerConfig,
    getLocalContext: localContext.state,
    agentDir: auth.agentDir,
    emit: (event) => {
      for (const target of BrowserWindow.getAllWindows()) target.webContents.send('worker:event', event);
    },
  });
  router ??= await createWorkRouter({
    runtime: auth.runtime,
    getSelection: auth.currentSelection,
    getLocalContext: localContext.state,
    getWorkspace: workspace.getPath,
    getBrowserConfig: browser.routerConfig,
    mcpAdapterPath: path.join(app.getAppPath(), 'node_modules/pi-mcp-adapter/index.ts'),
    chromeMcpPath: path.join(app.getAppPath(), 'node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'),
    fleet,
    agentDir: auth.agentDir,
    emit: (event) => {
      for (const target of BrowserWindow.getAllWindows()) target.webContents.send('router:event', event);
    },
  });

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

  ipcMain.handle('work:dispatch', (_event, task: string) => router?.dispatch(task) ?? null);
  ipcMain.handle('work:list', () => router?.list() ?? []);
  ipcMain.handle('work:cancel', (_event, id: string) =>
    router?.cancel(id) ?? { ok: false, error: 'work router is not ready' },
  );
  ipcMain.handle('workspace:state', () => workspace?.state());
  ipcMain.handle('workspace:select', async (event) => {
    const state = await workspace?.select(BrowserWindow.fromWebContents(event.sender) ?? undefined);
    if (state) {
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

  // Warm the image now so the first spawn is not an npm install mid-conversation.
  void ensureWorkerImage().catch(() => {
    /* surfaced on the panel when a worker is actually dispatched */
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on('before-quit', () => {
  router?.shutdown();
  fleet?.shutdown();
  browser?.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
