import { app, BrowserWindow, ipcMain, shell, systemPreferences } from 'electron';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createAuthService, type AuthService } from './auth-service';
import { ensureWorkerImage } from './docker';
import { startTokenServer } from './token-server';
import { createWorkerFleet, type WorkerFleet } from './workers';
import type { AuthEvent, AuthMethod, DelegationSelection } from '../shared/auth';
import { WORKER_MODEL_ID } from '../shared/config';

loadEnv({ path: path.join(app.getAppPath(), '../../.env'), quiet: true });
loadEnv({ quiet: true });

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let fleet: WorkerFleet | null = null;
let auth: AuthService | null = null;

const emitAuth = (event: AuthEvent) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('auth:event', event);
};

async function createWindow(setupUrl: string) {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--realtime-setup-url=${setupUrl}`],
    },
  });

  if (!auth) throw new Error('authentication service is not ready');
  fleet ??= createWorkerFleet({
    getSelection: auth.currentSelection,
    agentDir: auth.agentDir,
    emit: (event) => {
      if (!window.isDestroyed()) window.webContents.send('worker:event', event);
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

  ipcMain.handle('worker:dispatch', (_event, task: string) => fleet?.dispatch(task) ?? null);
  ipcMain.handle('worker:list', () => fleet?.list() ?? []);
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

app.on('before-quit', () => fleet?.shutdown());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
