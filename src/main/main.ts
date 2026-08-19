import { app, BrowserWindow, systemPreferences } from 'electron';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { startTokenServer } from './token-server';

loadEnv({ path: path.join(app.getAppPath(), '../../.env'), quiet: true });
loadEnv({ quiet: true });

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

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

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

app.whenReady().then(async () => {
  await systemPreferences.askForMediaAccess('microphone');
  const { url } = await startTokenServer(process.env.OPENAI_API_KEY);
  await createWindow(url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
