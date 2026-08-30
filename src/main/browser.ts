import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BrowserMode, BrowserState } from '../shared/browser';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const run = promisify(execFile);

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a browser debugging port'));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

export async function createBrowserService(stateDir: string) {
  const statePath = path.join(stateDir, 'browser.json');
  const profilePath = path.join(stateDir, 'visible-browser-profile');
  let mode: BrowserMode = 'headless';
  let chrome: ChildProcess | null = null;
  let debuggingPort: number | null = null;
  let existingChromePid: number | null = null;

  try {
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as { mode?: BrowserMode };
    if (saved.mode === 'visible' || saved.mode === 'headless') mode = saved.mode;
  } catch {
    // First launch or discarded preference.
  }

  const available = process.platform === 'darwin' && existsSync(CHROME_PATH);
  const state = (): BrowserState => ({ mode, available });

  async function discoverExistingChrome(): Promise<{ pid: number; port: number } | null> {
    try {
      const lock = await readlink(path.join(profilePath, 'SingletonLock'));
      const pid = Number(lock.match(/-(\d+)$/)?.[1]);
      if (!Number.isInteger(pid) || pid <= 0) return null;
      process.kill(pid, 0);
      const { stdout } = await run('ps', ['-p', String(pid), '-o', 'command=']);
      if (!stdout.includes(`--user-data-dir=${profilePath}`)) return null;
      const port = Number(stdout.match(/--remote-debugging-port=(\d+)/)?.[1]);
      if (!Number.isInteger(port) || port <= 0) return null;
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return response.ok ? { pid, port } : null;
    } catch {
      return null;
    }
  }

  async function ensureVisible() {
    if (debuggingPort) {
      try {
        const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
        if (response.ok) return `http://127.0.0.1:${debuggingPort}`;
      } catch {
        // Browser was closed outside Ambient; rebuild it below.
      }
      debuggingPort = null;
      existingChromePid = null;
      chrome = null;
    }

    await mkdir(profilePath, { recursive: true, mode: 0o700 });
    const existing = await discoverExistingChrome();
    if (existing) {
      existingChromePid = existing.pid;
      debuggingPort = existing.port;
      return `http://127.0.0.1:${existing.port}`;
    }

    debuggingPort = await freePort();
    chrome = spawn(
      CHROME_PATH,
      [
        `--user-data-dir=${profilePath}`,
        `--remote-debugging-port=${debuggingPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    chrome.once('exit', () => {
      existingChromePid = null;
      chrome = null;
      debuggingPort = null;
    });

    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
        if (response.ok) return `http://127.0.0.1:${debuggingPort}`;
      } catch {
        // Chrome is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error('Visible Chrome did not expose its debugging endpoint');
  }

  return {
    state,
    async setMode(next: BrowserMode) {
      if (next !== 'headless' && next !== 'visible') throw new Error('Invalid browser mode');
      if (next === 'visible' && !available) throw new Error('Visible browser mode currently requires macOS');
      mode = next;
      await writeFile(statePath, `${JSON.stringify({ mode }, null, 2)}\n`, { mode: 0o600 });
      // Pre-warm Chrome so the first worker doesn't pay the cold-start cost.
      if (next === 'visible') {
        void ensureVisible().catch(() => {
          // Pre-warm is best-effort; the next dispatch will retry and surface errors.
        });
      }
      return state();
    },
    async workerConfig(): Promise<{ mode: BrowserMode; browserUrl?: string }> {
      return mode === 'visible' ? { mode, browserUrl: await ensureVisible() } : { mode };
    },
    async routerConfig(): Promise<{ mode: BrowserMode; browserUrl?: string; executablePath?: string }> {
      if (mode === 'visible') {
        await ensureVisible();
        if (!debuggingPort) throw new Error('Visible Chrome debugging endpoint is unavailable');
        return { mode, browserUrl: `http://127.0.0.1:${debuggingPort}` };
      }
      if (!available) throw new Error('Host router browser tools currently require Google Chrome on macOS');
      return { mode, executablePath: CHROME_PATH };
    },
    shutdown() {
      if (chrome) chrome.kill('SIGTERM');
      else if (existingChromePid) {
        try {
          process.kill(existingChromePid, 'SIGTERM');
        } catch {
          // It already exited.
        }
      }
      chrome = null;
      existingChromePid = null;
      debuggingPort = null;
    },
  };
}
