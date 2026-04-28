import { ipcMain } from "electron";
import type { SecureCredentialStore } from "../integrations/secure-credential-store";
import { API_KEY_DEFINITIONS } from "../api-key-registry";

const GEMINI_ALIAS = "GOOGLE_GENERATIVE_AI_API_KEY";

export function registerApiKeyHandlers(store: SecureCredentialStore) {
  ipcMain.handle("get-api-key-definitions", () => {
    return API_KEY_DEFINITIONS;
  });

  ipcMain.handle("get-api-key-status", async () => {
    const status: Record<string, boolean> = {};
    for (const def of API_KEY_DEFINITIONS) {
      const stored = await store.getApiKey(def.envVar);
      status[def.envVar] = !!stored || !!process.env[def.envVar];
    }
    return status;
  });

  ipcMain.handle("save-api-key", async (_event, envVar: string, value: string) => {
    if (!store.encryptionAvailable()) {
      return { ok: false, error: "Secure storage is unavailable on this system." };
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: false, error: "API key cannot be empty." };
    }
    await store.setApiKey(envVar, trimmed);
    process.env[envVar] = trimmed;
    if (envVar === "GEMINI_API_KEY") {
      process.env[GEMINI_ALIAS] = trimmed;
    }
    return { ok: true };
  });

  ipcMain.handle("delete-api-key", async (_event, envVar: string) => {
    await store.setApiKey(envVar, undefined);
    delete process.env[envVar];
    if (envVar === "GEMINI_API_KEY") {
      delete process.env[GEMINI_ALIAS];
    }
    return { ok: true };
  });
}
