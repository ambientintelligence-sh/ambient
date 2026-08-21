import { contextBridge, ipcRenderer } from 'electron';
import type { Worker, WorkerEvent } from '../shared/worker';

const flag = '--realtime-setup-url=';
const setupUrl = process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length) ?? '';

contextBridge.exposeInMainWorld('ambient', {
  setupUrl,
  dispatchWorker: (task: string): Promise<Worker> => ipcRenderer.invoke('worker:dispatch', task),
  listWorkers: (): Promise<Worker[]> => ipcRenderer.invoke('worker:list'),
  onWorkerEvent: (listener: (event: WorkerEvent) => void) => {
    const handler = (_: unknown, event: WorkerEvent) => listener(event);
    ipcRenderer.on('worker:event', handler);
    return () => ipcRenderer.off('worker:event', handler);
  },
});
