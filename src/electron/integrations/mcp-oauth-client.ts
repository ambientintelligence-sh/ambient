import { createServer, type Server } from "node:http";
import crypto from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpOAuthProviderConfig } from "./mcp-oauth-providers";
import { getCallbackUrl } from "./mcp-oauth-providers";
import { SecureCredentialStore } from "./secure-credential-store";

const CALLBACK_HOST = "127.0.0.1";

function randomState(): string {
  return crypto.randomBytes(18).toString("base64url");
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h2>${title}</h2><p>${body}</p><p>You can close this window and return to Ambient.</p></body></html>`;
}

export function createOAuthProvider(
  config: McpOAuthProviderConfig,
  store: SecureCredentialStore,
  openExternal: (url: string) => Promise<void>,
): OAuthClientProvider {
  const callbackUrl = getCallbackUrl(config);
  const { id } = config;

  return {
    get redirectUrl() {
      return callbackUrl;
    },

    get clientMetadata() {
      return {
        redirect_uris: [callbackUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_name: "Ambient Desktop MCP Client",
      };
    },

    async state() {
      const state = randomState();
      await store.setOAuthPendingState(id, state);
      return state;
    },

    async clientInformation() {
      return store.getOAuthClientInformation(id);
    },

    async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
      await store.setOAuthClientInformation(id, clientInformation);
    },

    async tokens() {
      return store.getOAuthTokens(id);
    },

    async saveTokens(tokens: OAuthTokens) {
      await store.setOAuthTokens(id, tokens);
      await store.setOAuthMetadata(id, {
        label: "Connected",
        lastConnectedAt: Date.now(),
        lastError: undefined,
      });
    },

    async redirectToAuthorization(authorizationUrl: URL) {
      await openExternal(String(authorizationUrl));
    },

    async saveCodeVerifier(codeVerifier: string) {
      await store.setOAuthCodeVerifier(id, codeVerifier);
    },

    async codeVerifier() {
      const verifier = await store.getOAuthCodeVerifier(id);
      if (!verifier) {
        throw new Error(`Missing PKCE code verifier for ${config.label} OAuth flow.`);
      }
      return verifier;
    },

    async invalidateCredentials(scope) {
      if (scope === "all" || scope === "tokens") {
        await store.setOAuthTokens(id, undefined);
      }
      if (scope === "all" || scope === "client") {
        await store.setOAuthClientInformation(id, undefined);
      }
      if (scope === "all" || scope === "verifier") {
        await store.setOAuthCodeVerifier(id, undefined);
      }
    },
  };
}

export async function waitForOAuthAuthorizationCode(
  config: McpOAuthProviderConfig,
  expectedState: string,
  timeoutMs = 180_000,
): Promise<string> {
  const callbackUrl = getCallbackUrl(config);

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    let server: Server | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (server) {
        server.close(() => fn());
      } else {
        fn();
      }
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for OAuth callback.")));
    }, timeoutMs);

    server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", callbackUrl);
      if (reqUrl.pathname !== config.callbackPath) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const error = reqUrl.searchParams.get("error");
      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state");

      if (error) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage(`${config.label} connection failed`, `OAuth returned error: ${error}`));
        clearTimeout(timeout);
        finish(() => reject(new Error(`OAuth error: ${error}`)));
        return;
      }

      if (!code) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage(`${config.label} connection failed`, "Missing authorization code."));
        return;
      }

      if (!state || state !== expectedState) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage(`${config.label} connection failed`, "OAuth state did not match the expected value."));
        clearTimeout(timeout);
        finish(() => reject(new Error("OAuth state mismatch.")));
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(htmlPage(`${config.label} connected`, "Authorization complete."));
      clearTimeout(timeout);
      finish(() => resolve(code));
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      finish(() => reject(error));
    });

    server.listen(config.callbackPort, CALLBACK_HOST);
  });
}
