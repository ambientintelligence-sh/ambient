/**
 * OAuth login + token management for AI provider subscriptions
 * (ChatGPT Plus/Pro via pi-ai's Codex OAuth flow).
 *
 * All functions here run in the Electron main process. They shell out to
 * `@mariozechner/pi-ai/oauth` for the protocol details and persist the
 * resulting credentials to `SecureCredentialStore`.
 */

import { shell } from "electron";
import { log } from "@core/logger";
import {
  SecureCredentialStore,
  type AiOAuthCredentials,
} from "./secure-credential-store";

const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

// A safety margin — refresh a few minutes before the token would actually
// expire so we don't hand out an expired key mid-request.
const REFRESH_LEEWAY_MS = 60_000;

export type OpenAiCodexStatus = {
  loggedIn: boolean;
  accountId?: string;
  lastConnectedAt?: number;
};

/**
 * Run the OpenAI Codex OAuth login flow. Opens the authorize URL in the
 * user's default browser, waits for the localhost callback, exchanges the
 * code for tokens, and persists them to the credential store.
 *
 * Rejects if the user aborts, the HTTP server can't bind port 1455, or the
 * token exchange fails.
 */
export async function loginOpenAiCodex(
  store: SecureCredentialStore,
): Promise<OpenAiCodexStatus> {
  const { loginOpenAICodex } = await import("@mariozechner/pi-ai/oauth");

  try {
    const creds = await loginOpenAICodex({
      onAuth: ({ url }) => {
        log("INFO", "ChatGPT OAuth: opening browser for authorization");
        void shell.openExternal(url);
      },
      // The browser-callback path is the only one we expose — no TUI paste fallback.
      onPrompt: async () => {
        throw new Error(
          "ChatGPT OAuth requires the browser callback to complete. Please finish login in the browser.",
        );
      },
      onProgress: (message: string) => {
        log("INFO", `ChatGPT OAuth: ${message}`);
      },
      originator: "ambient",
    });

    const accountId = typeof creds.accountId === "string" ? creds.accountId : undefined;
    await store.setAiOAuthCredentials(
      OPENAI_CODEX_PROVIDER_ID,
      creds as AiOAuthCredentials,
      {
        label: "ChatGPT Plus/Pro",
        accountId,
      },
    );
    log("INFO", `ChatGPT OAuth: login succeeded${accountId ? ` (account ${accountId})` : ""}`);

    return {
      loggedIn: true,
      accountId,
      lastConnectedAt: Date.now(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `ChatGPT OAuth login failed: ${message}`);
    throw error;
  }
}

/** Remove stored ChatGPT OAuth credentials. */
export async function logoutOpenAiCodex(store: SecureCredentialStore): Promise<void> {
  await store.clearAiOAuthProvider(OPENAI_CODEX_PROVIDER_ID);
  log("INFO", "ChatGPT OAuth: cleared stored credentials");
}

/** Current login status for display in Settings. */
export async function getOpenAiCodexStatus(
  store: SecureCredentialStore,
): Promise<OpenAiCodexStatus> {
  const creds = await store.getAiOAuthCredentials(OPENAI_CODEX_PROVIDER_ID);
  const meta = await store.getAiProviderMeta(OPENAI_CODEX_PROVIDER_ID);
  if (!creds) {
    return { loggedIn: false };
  }
  return {
    loggedIn: true,
    accountId: typeof creds.accountId === "string" ? creds.accountId : meta?.accountId,
    lastConnectedAt: meta?.lastConnectedAt,
  };
}

/**
 * Returns a fresh access token, refreshing via the pi-ai OAuth provider when
 * the stored token is expired (or within REFRESH_LEEWAY_MS of expiring).
 * Persists the refreshed credentials back to the store.
 *
 * Throws if no credentials are stored or the refresh fails — the caller
 * (agent runtime) should surface this as a session error so the user knows
 * to re-login.
 */
export async function getOpenAiCodexAccessToken(
  store: SecureCredentialStore,
): Promise<string> {
  const creds = await store.getAiOAuthCredentials(OPENAI_CODEX_PROVIDER_ID);
  if (!creds) {
    throw new Error("Not logged in to ChatGPT. Open Settings → ChatGPT to connect.");
  }

  if (Date.now() < creds.expires - REFRESH_LEEWAY_MS) {
    return creds.access;
  }

  const { refreshOpenAICodexToken } = await import("@mariozechner/pi-ai/oauth");
  try {
    const refreshed = await refreshOpenAICodexToken(creds.refresh);
    const accountId = typeof refreshed.accountId === "string" ? refreshed.accountId : creds.accountId;
    await store.setAiOAuthCredentials(
      OPENAI_CODEX_PROVIDER_ID,
      refreshed as AiOAuthCredentials,
      { accountId },
    );
    log("INFO", "ChatGPT OAuth: refreshed access token");
    return refreshed.access;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `ChatGPT OAuth refresh failed: ${message}`);
    throw new Error(`ChatGPT token refresh failed: ${message}. Please log in again.`);
  }
}
