import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest, type Server } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
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
  let proxy: Server | null = null;
  let proxyPort: number | null = null;

  try {
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as { mode?: BrowserMode };
    if (saved.mode === 'visible' || saved.mode === 'headless') mode = saved.mode;
  } catch {
    // First launch or discarded preference.
  }

  const available = process.platform === 'darwin' && existsSync(CHROME_PATH);
  const state = (): BrowserState => ({ mode, available });

  async function startDebugProxy(chromePort: number) {
    const publicPort = await freePort();
    const server = createHttpServer((incoming, outgoing) => {
      const forwarded = httpRequest({
        host: '127.0.0.1',
        port: chromePort,
        method: incoming.method,
        path: incoming.url,
        headers: { ...incoming.headers, host: `127.0.0.1:${chromePort}` },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks);
          const contentType = String(response.headers['content-type'] ?? '');
          const body = contentType.includes('json')
            ? Buffer.from(raw.toString().replaceAll(
                `ws://127.0.0.1:${chromePort}`,
                `ws://host.docker.internal:${publicPort}`,
              ).replaceAll(
                `ws://localhost:${chromePort}`,
                `ws://host.docker.internal:${publicPort}`,
              ))
            : raw;
          outgoing.writeHead(response.statusCode ?? 502, {
            ...response.headers,
            'content-length': String(body.length),
          });
          outgoing.end(body);
        });
      });
      forwarded.on('error', (error) => {
        outgoing.writeHead(502).end(error.message);
      });
      incoming.pipe(forwarded);
    });
    server.on('upgrade', (request, socket, head) => {
      const upstream = connect(chromePort, '127.0.0.1', () => {
        const headers = Object.entries(request.headers)
          .map(([name, value]) => `${name}: ${value}`)
          .filter((line) => !line.toLowerCase().startsWith('host:'));
        upstream.write(
          `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n` +
          `Host: 127.0.0.1:${chromePort}\r\n${headers.join('\r\n')}\r\n\r\n`,
        );
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(publicPort, '0.0.0.0', resolve);
    });
    proxy = server;
    proxyPort = publicPort;
    return `http://host.docker.internal:${publicPort}`;
  }

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
    if (debuggingPort && proxyPort) {
      try {
        const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
        if (response.ok) return `http://host.docker.internal:${proxyPort}`;
      } catch {
        // Browser was closed outside Ambient; rebuild it below.
      }
      proxy?.close();
      proxy = null;
      proxyPort = null;
      debuggingPort = null;
      existingChromePid = null;
      chrome = null;
    }

    await mkdir(profilePath, { recursive: true, mode: 0o700 });
    const existing = await discoverExistingChrome();
    if (existing) {
      existingChromePid = existing.pid;
      debuggingPort = existing.port;
      return startDebugProxy(existing.port);
    }

    debuggingPort = await freePort();
    chrome = spawn(
      CHROME_PATH,
      [
        `--user-data-dir=${profilePath}`,
        `--remote-debugging-port=${debuggingPort}`,
        '--remote-debugging-address=0.0.0.0',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    chrome.once('exit', () => {
      proxy?.close();
      proxy = null;
      proxyPort = null;
      existingChromePid = null;
      chrome = null;
      debuggingPort = null;
    });

    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
        if (response.ok) return startDebugProxy(debuggingPort);
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
    shutdown() {
      proxy?.close();
      proxy = null;
      proxyPort = null;
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
