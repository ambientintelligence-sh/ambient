import { ipcMain } from "electron";
import { toReadableError } from "@core/text/text-utils";
import type { SecureCredentialStore } from "../integrations/secure-credential-store";
import {
  getOpenAiCodexStatus,
  loginOpenAiCodex,
  logoutOpenAiCodex,
} from "../integrations/ai-oauth";

export function registerAiOAuthHandlers(store: SecureCredentialStore) {
  ipcMain.handle("auth:openai-codex:status", async () => {
    try {
      return { ok: true as const, ...(await getOpenAiCodexStatus(store)) };
    } catch (error) {
      return { ok: false as const, error: toReadableError(error) };
    }
  });

  ipcMain.handle("auth:openai-codex:login", async () => {
    try {
      const status = await loginOpenAiCodex(store);
      return { ok: true as const, ...status };
    } catch (error) {
      return { ok: false as const, error: toReadableError(error) };
    }
  });

  ipcMain.handle("auth:openai-codex:logout", async () => {
    try {
      await logoutOpenAiCodex(store);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: toReadableError(error) };
    }
  });
}
