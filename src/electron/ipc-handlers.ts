import { app, type BrowserWindow } from "electron";
import path from "node:path";
import type { AppDatabase } from "@core/db/db";
import { validateEnv } from "@core/config";
import { log } from "@core/logger";
import { Session } from "@core/session";
import { toReadableError } from "@core/text/text-utils";
import type { AppConfigOverrides } from "@core/types";
import { registerAgentHandlers } from "./ipc/register-agent-handlers";
import { registerProjectHandlers } from "./ipc/register-project-handlers";
import { registerSessionHandlers } from "./ipc/register-session-handlers";
import { registerTaskInsightHandlers } from "./ipc/register-task-insight-handlers";
import { registerIntegrationHandlers } from "./ipc/register-integration-handlers";
import { registerApiKeyHandlers } from "./ipc/register-api-key-handlers";
import { registerSkillHandlers } from "./ipc/register-skill-handlers";
import { registerLearningHandlers } from "./ipc/register-learning-handlers";
import { buildSessionConfig, shutdownCurrentSession, wireSessionEvents } from "./ipc/ipc-utils";
import type { EnsureSession, SessionRef } from "./ipc/types";
import { createIntegrationManager } from "./integrations";
import { SecureCredentialStore } from "./integrations/secure-credential-store";
import type { IntegrationManager } from "./integrations/types";
import { connectCodex, isCodexConnected, startCodexTask, waitForCodexTask, cancelCodexTask } from "@core/agents/codex-client";
import type { CodexClient } from "@core/agents/codex-client";

function getCodexClient(): CodexClient | null {
  if (!isCodexConnected()) {
    const result = connectCodex();
    if (result.ok === false) {
      log("WARN", `Codex auto-connect failed: ${result.error}`);
      return null;
    }
    log("INFO", "Codex auto-connected on first agent launch");
  }
  return { isConnected: true, startTask: startCodexTask, waitForTask: waitForCodexTask, cancelTask: cancelCodexTask };
}

const sessionRef: SessionRef = { current: null };
let registeredDb: AppDatabase | null = null;
let integrationManager: IntegrationManager | null = null;

export function shutdownSessionOnAppQuit() {
  if (!registeredDb) return;
  void shutdownCurrentSession(sessionRef, registeredDb);
  void integrationManager?.dispose();
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null, db: AppDatabase) {
  registeredDb = db;
  if (integrationManager) {
    void integrationManager.dispose();
  }

  const userData = app.getPath("userData");
  const store = new SecureCredentialStore(
    path.join(userData, "integrations.credentials.json"),
  );
  integrationManager = createIntegrationManager(userData, store);
  const manager = integrationManager;

  registerApiKeyHandlers(store);

  const ensureSession: EnsureSession = async (
    sessionId: string,
    appConfig?: AppConfigOverrides,
  ) => {
    if (sessionRef.current?.sessionId === sessionId) {
      if (!appConfig) {
        return { ok: true };
      }

      const currentSession = sessionRef.current;
      const desiredConfig = buildSessionConfig(
        currentSession.config.sourceLang,
        currentSession.config.targetLang,
        appConfig,
      );
      const currentConfigSerialized = JSON.stringify(currentSession.config);
      const desiredConfigSerialized = JSON.stringify(desiredConfig);
      if (currentConfigSerialized === desiredConfigSerialized) {
        return { ok: true };
      }

      await shutdownCurrentSession(sessionRef, db);

      try {
        validateEnv(desiredConfig);
      } catch (error) {
        return { ok: false, error: toReadableError(error) };
      }

      const activeSession = new Session(desiredConfig, db, sessionId, {
        getExternalTools: manager.getExternalTools,
        getCodexClient,
        dataDir: app.getPath("userData"),
      });
      sessionRef.current = activeSession;
      wireSessionEvents(sessionRef, activeSession, getWindow, db);

      try {
        await activeSession.initialize();
        return { ok: true };
      } catch (error) {
        log("ERROR", `Session ensure failed: ${toReadableError(error)}`);
        return { ok: false, error: toReadableError(error) };
      }
    }

    await shutdownCurrentSession(sessionRef, db);

    const meta = db.getSession(sessionId);
    if (!meta) {
      return { ok: false, error: `Session ${sessionId} not found` };
    }

    const sourceLang = meta.sourceLang ?? "ko";
    const targetLang = meta.targetLang ?? "en";
    const config = buildSessionConfig(sourceLang, targetLang, appConfig);

    try {
      validateEnv(config);
    } catch (error) {
      return { ok: false, error: toReadableError(error) };
    }

    const activeSession = new Session(config, db, sessionId, {
      getExternalTools: manager.getExternalTools,
      dataDir: app.getPath("userData"),
    });
    sessionRef.current = activeSession;
    wireSessionEvents(sessionRef, activeSession, getWindow, db);

    try {
      await activeSession.initialize();
      return { ok: true };
    } catch (error) {
      log("ERROR", `Session ensure failed: ${toReadableError(error)}`);
      return { ok: false, error: toReadableError(error) };
    }
  };

  registerProjectHandlers({ db });
  registerSessionHandlers({
    db,
    getWindow,
    sessionRef,
    getExternalTools: manager.getExternalTools,
    getCodexClient,
    dataDir: app.getPath("userData"),
  });
  registerTaskInsightHandlers({ db, getWindow, sessionRef, ensureSession });
  registerAgentHandlers({ db, getWindow, sessionRef, ensureSession });
  registerIntegrationHandlers(manager);
  registerSkillHandlers();
  registerLearningHandlers();
}
