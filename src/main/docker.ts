import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { app } from 'electron';

const run = promisify(execFile);

export const WORKER_IMAGE = 'ambient-pi-worker:1';

/** In a packaged app the build context is copied out of the asar as an extraResource. */
function contextDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'docker', 'worker')
    : path.join(app.getAppPath(), 'docker', 'worker');
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    await run('docker', ['info'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function imageExists(): Promise<boolean> {
  try {
    await run('docker', ['image', 'inspect', WORKER_IMAGE]);
    return true;
  } catch {
    return false;
  }
}

let building: Promise<void> | null = null;

/**
 * Builds the worker image once per app run. Kicked off at startup so the first
 * spawn does not pay for an npm install mid-conversation.
 */
export function ensureWorkerImage(): Promise<void> {
  building ??= (async () => {
    if (!(await dockerAvailable())) {
      throw new Error('Docker is not running — start Docker Desktop and restart Ambient.');
    }
    if (await imageExists()) return;

    await new Promise<void>((resolve, reject) => {
      const build = spawn('docker', ['build', '-t', WORKER_IMAGE, contextDir()], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      build.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      build.on('error', reject);
      build.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`worker image build failed:\n${stderr.trim().slice(-1500)}`));
      });
    });
  })().catch((error: unknown) => {
    building = null; // let a later spawn retry
    throw error;
  });

  return building;
}
