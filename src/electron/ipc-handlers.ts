import { app, type BrowserWindow } from "electron";
import path from "node:path";
import type { AppDatabase } from "@core/db/db";
import { validateEnv } from "@core/config";
import { log } from "@core/logger";
import { Session } from "@core/session";
import { toReadableError } from "@core/text/text-utils";
import type { AppConfigOverrides, SessionConfig } from "@core/types";
import { registerAgentHandlers } from "./ipc/register-agent-handlers";
import { registerProjectHandlers } from "./ipc/register-project-handlers";
import { registerSessionHandlers } from "./ipc/register-session-handlers";
import { registerTaskInsightHandlers } from "./ipc/register-task-insight-handlers";
import { registerIntegrationHandlers } from "./ipc/register-integration-handlers";
import { registerApiKeyHandlers } from "./ipc/register-api-key-handlers";
import { registerAiOAuthHandlers } from "./ipc/register-ai-oauth-handlers";
import { registerSkillHandlers } from "./ipc/register-skill-handlers";
import { registerLearningHandlers } from "./ipc/register-learning-handlers";
import { buildSessionConfig, shutdownCurrentSession, wireSessionEvents } from "./ipc/ipc-utils";
import type { EnsureSession, SessionRef } from "./ipc/types";
import { createIntegrationManager } from "./integrations";
import { SecureCredentialStore } from "./integrations/secure-credential-store";
import { getOpenAiCodexAccessToken } from "./integrations/ai-oauth";
import type { IntegrationManager } from "./integrations/types";
import { connectCodex, disconnectCodex, isCodexConnected, startCodexTask, waitForCodexTask, getCodexSnapshot, cancelCodexTask } from "@core/agents/codex-client";
import type { CodexClient } from "@core/agents/codex-client";
import {
  connectClaude,
  disconnectClaude,
  isClaudeConnected,
  startClaudeTask,
  waitForClaudeTask,
  getClaudeSnapshot,
  cancelClaudeTask,
} from "@core/agents/claude-client";
import type { ClaudeClient } from "@core/agents/claude-client";

function getCodexClient(): CodexClient | null {
  if (!isCodexConnected()) {
    const result = connectCodex();
    if (result.ok === false) {
      log("WARN", `Codex auto-connect failed: ${result.error}`);
      return null;
    }
    log("INFO", "Codex auto-connected on first agent launch");
  }
  return {
    isConnected: true,
    startTask: startCodexTask,
    waitForTask: waitForCodexTask,
    getSnapshot: getCodexSnapshot,
    cancelTask: cancelCodexTask,
  };
}

function getClaudeClient(): ClaudeClient | null {
  if (!isClaudeConnected()) {
    const result = connectClaude();
    if (result.ok === false) {
      log("WARN", `Claude Code auto-connect failed: ${result.error}`);
      return null;
    }
    log("INFO", "Claude Code auto-connected on first agent launch");
  }
  return {
    isConnected: true,
    startTask: startClaudeTask,
    waitForTask: waitForClaudeTask,
    getSnapshot: getClaudeSnapshot,
    cancelTask: cancelClaudeTask,
  };
}

/**
 * Produce the per-session coding-agent getters based on the user's selection.
 * Only one provider is ever active — the other getter is intentionally
 * undefined so the agent tool registration skips it entirely. This removes
 * the "two tools in scope → model picks wrong one" failure mode and keeps
 * the model identity unambiguous.
 */
function codingAgentGetters(config: SessionConfig): {
  getCodexClient?: typeof getCodexClient;
  getClaudeClient?: typeof getClaudeClient;
} {
  if (config.codingAgent === "codex") return { getCodexClient };
  if (config.codingAgent === "claude") return { getClaudeClient };
  return {};
}

const sessionRef: SessionRef = { current: null };
let registeredDb: AppDatabase | null = null;
let integrationManager: IntegrationManager | null = null;

export function getActiveSessionId(): string | null {
  return sessionRef.current?.sessionId ?? null;
}

export function shutdownSessionOnAppQuit() {
  if (!registeredDb) return;
  void shutdownCurrentSession(sessionRef, registeredDb);
  void integrationManager?.dispose();
  // Force-terminate any in-flight coding-agent tasks so their CLI subprocesses
  // don't orphan past app exit.
  try { disconnectCodex(); } catch { /* noop */ }
  try { disconnectClaude(); } catch { /* noop */ }
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
  registerAiOAuthHandlers(store);

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
        {
          direction: currentSession.config.direction,
          translationEnabled: currentSession.config.translationEnabled,
        },
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
        ...codingAgentGetters(desiredConfig),
        getOpenAiCodexAccessToken: () => getOpenAiCodexAccessToken(store),
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
    const config = buildSessionConfig(sourceLang, targetLang, appConfig, {
      direction: meta.translationDirection ?? undefined,
      translationEnabled: meta.translationEnabled,
    });

    try {
      validateEnv(config);
    } catch (error) {
      return { ok: false, error: toReadableError(error) };
    }

    const activeSession = new Session(config, db, sessionId, {
      getExternalTools: manager.getExternalTools,
      ...codingAgentGetters(config),
      getOpenAiCodexAccessToken: () => getOpenAiCodexAccessToken(store),
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
    getOpenAiCodexAccessToken: () => getOpenAiCodexAccessToken(store),
    dataDir: app.getPath("userData"),
  });
  registerTaskInsightHandlers({ db, getWindow, sessionRef, ensureSession });
  registerAgentHandlers({ db, getWindow, sessionRef, ensureSession });
  registerIntegrationHandlers(manager);
  registerSkillHandlers();
  registerLearningHandlers();
}
