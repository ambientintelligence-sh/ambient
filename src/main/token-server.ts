import { createServer, type Server } from 'node:http';
import { createOpenAI } from '@ai-sdk/openai';
import { experimental_getRealtimeToolDefinitions } from 'ai';
import { REALTIME_MODEL_ID, REALTIME_SESSION_CONFIG, SETUP_ROUTE } from '../shared/config';
import { REALTIME_TOOLS } from '../shared/tools';

/**
 * The realtime hook fetches its ephemeral credential from a URL. In Electron the
 * renderer has no origin server, so the main process hosts one on loopback —
 * that keeps OPENAI_API_KEY out of the renderer process entirely.
 */
export async function startTokenServer(apiKey: string | undefined): Promise<{ url: string; server: Server }> {
  const openai = createOpenAI({ apiKey: apiKey ?? 'missing' });

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    if (!req.url?.startsWith(SETUP_ROUTE)) {
      res.writeHead(404).end();
      return;
    }

    if (!apiKey) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'OPENAI_API_KEY is not set — add it to .env and restart' }));
      return;
    }

    experimental_getRealtimeToolDefinitions({ tools: REALTIME_TOOLS })
      .then(async (tools) => {
        const token = await openai.experimental_realtime.getToken({
          model: REALTIME_MODEL_ID,
          sessionConfig: { ...REALTIME_SESSION_CONFIG, tools },
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...token, tools }));
      })
      .catch((error: unknown) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('token server failed to bind a port');
  }

  return { url: `http://127.0.0.1:${address.port}${SETUP_ROUTE}`, server };
}
