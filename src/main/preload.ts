import { contextBridge } from 'electron';

const flag = '--realtime-setup-url=';
const setupUrl = process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length) ?? '';

contextBridge.exposeInMainWorld('ambient', { setupUrl });
