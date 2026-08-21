import { app, BrowserWindow, ipcMain, systemPreferences } from 'electron';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { ensureWorkerImage } from './docker';
import { startTokenServer } from './token-server';
import { createWorkerFleet, type WorkerFleet } from './workers';
import { WORKER_MODEL_ID } from '../shared/config';

loadEnv({ path: path.join(app.getAppPath(), '../../.env'), quiet: true });
loadEnv({ quiet: true });

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let fleet: WorkerFleet | null = null;

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

  fleet ??= createWorkerFleet({
    model: process.env.PI_WORKER_MODEL ?? WORKER_MODEL_ID,
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
  ipcMain.handle('worker:dispatch', (_event, task: string) => fleet?.dispatch(task) ?? null);
  ipcMain.handle('worker:list', () => fleet?.list() ?? []);

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
