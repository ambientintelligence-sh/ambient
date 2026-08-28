import { createServer, type Server } from 'node:http';
import OpenAI from 'openai';
import { REALTIME_MODEL_ID, SETUP_ROUTE } from '../shared/config';

/**
 * Mints short-lived client secrets for the renderer's official OpenAI WebRTC
 * session. The long-lived OPENAI_API_KEY never leaves the Electron main process.
 */
export async function startTokenServer(apiKey: string | undefined): Promise<{ url: string; server: Server }> {
  const openai = new OpenAI({ apiKey: apiKey ?? 'missing' });

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

    openai.realtime.clientSecrets
      .create({
        expires_after: { anchor: 'created_at', seconds: 60 },
        session: {
          type: 'realtime',
          model: REALTIME_MODEL_ID,
          output_modalities: ['audio'],
        },
      })
      .then((secret) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ token: secret.value, expiresAt: secret.expires_at }));
      })
      .catch((error: unknown) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('token server failed to bind a port');
  return { url: `http://127.0.0.1:${address.port}${SETUP_ROUTE}`, server };
}
