import { ipcMain, systemPreferences } from "electron";
import { listMicDevices } from "../../audio";
import { validateEnv } from "@core/config";
import { log } from "@core/logger";
import { Session } from "@core/session";
import { toReadableError } from "@core/text/text-utils";
import type { AppConfigOverrides, FinalSummary, LanguageCode } from "@core/types";
import { SUPPORTED_LANGUAGES } from "@core/types";
import { buildSessionConfig, shutdownCurrentSession, wireSessionEvents } from "./ipc-utils";
import type { IpcDeps } from "./types";
import type { AgentExternalToolSet } from "@core/agents/external-tools";

type SessionHandlerDeps = IpcDeps & {
  getExternalTools?: () => Promise<AgentExternalToolSet>;
  getCodexClient?: import("@core/agents/codex-client").GetCodexClient;
  dataDir?: string;
};

export function registerSessionHandlers({ db, getWindow, sessionRef, getExternalTools, getCodexClient, dataDir }: SessionHandlerDeps) {
  ipcMain.handle("get-languages", () => {
    return SUPPORTED_LANGUAGES;
  });

  ipcMain.handle(
    "start-session",
    async (
      _event,
      sourceLang: LanguageCode,
      targetLang: LanguageCode,
      appConfig?: AppConfigOverrides,
      projectId?: string,
    ) => {
      await shutdownCurrentSession(sessionRef, db);

      const config = buildSessionConfig(sourceLang, targetLang, appConfig);
      try {
        validateEnv(config);
      } catch (error) {
        return { ok: false, error: toReadableError(error) };
      }

      const recent = db.getMostRecentSession();
      let sessionId: string;
      if (recent && !recent.endedAt && db.isSessionEmpty(recent.id)) {
        db.reuseSession(recent.id, sourceLang, targetLang);
        sessionId = recent.id;
        log("INFO", `Reusing empty session: ${sessionId}`);
      } else {
        sessionId = crypto.randomUUID();
        db.createSession(sessionId, sourceLang, targetLang, undefined, projectId);
      }

      const activeSession = new Session(config, db, sessionId, { getExternalTools, getCodexClient, dataDir });
      sessionRef.current = activeSession;
      wireSessionEvents(sessionRef, activeSession, getWindow, db);

      try {
        await activeSession.initialize();
        return { ok: true, sessionId: activeSession.sessionId };
      } catch (error) {
        log("ERROR", `Session init failed: ${toReadableError(error)}`);
        return { ok: false, error: toReadableError(error) };
      }
    },
  );

  ipcMain.handle(
    "resume-session",
    async (_event, sessionId: string, appConfig?: AppConfigOverrides) => {
      await shutdownCurrentSession(sessionRef, db);

      const meta = db.getSession(sessionId);
      if (!meta) {
        return { ok: false, error: `Session ${sessionId} not found` };
      }

      const sourceLang = meta.sourceLang ?? "ko";
      const targetLang = meta.targetLang ?? "en";
      const config = buildSessionConfig(
        sourceLang as LanguageCode,
        targetLang as LanguageCode,
        appConfig,
      );

      try {
        validateEnv(config);
      } catch (error) {
        return { ok: false, error: toReadableError(error) };
      }

      const activeSession = new Session(config, db, sessionId, { getExternalTools, getCodexClient, dataDir });
      sessionRef.current = activeSession;
      wireSessionEvents(sessionRef, activeSession, getWindow, db);

      try {
        await activeSession.initialize();
        return {
          ok: true,
          sessionId,
          blocks: db.getBlocksForSession(sessionId),
          tasks: db.getTasksForSession(sessionId),
          insights: db.getInsightsForSession(sessionId),
          agents: db.getAgentsForSession(sessionId),
        };
      } catch (error) {
        log("ERROR", `Session resume failed: ${toReadableError(error)}`);
        return { ok: false, error: toReadableError(error) };
      }
    },
  );

  ipcMain.handle("start-recording", async () => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    await sessionRef.current.startRecording();
    return { ok: true };
  });

  ipcMain.handle("stop-recording", () => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    sessionRef.current.stopRecording();
    return { ok: true };
  });

  ipcMain.handle("toggle-recording", async () => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    if (sessionRef.current.recording) {
      sessionRef.current.stopRecording();
    } else {
      await sessionRef.current.startRecording(true);
    }
    return { ok: true, recording: sessionRef.current?.recording ?? false };
  });

  ipcMain.handle("toggle-mic", async () => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    if (sessionRef.current.micEnabled) {
      sessionRef.current.stopMic();
      return { ok: true, micEnabled: false, captureInRenderer: false };
    }

    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status !== "granted") {
        const granted = await systemPreferences.askForMediaAccess("microphone");
        if (!granted) {
          return {
            ok: false,
            error:
              "Microphone permission denied. Grant access in System Settings > Privacy & Security > Microphone.",
          };
        }
      }
    }

    sessionRef.current.startMicFromIPC();
    return { ok: true, micEnabled: true, captureInRenderer: true };
  });

  ipcMain.on("mic-audio-data", (_event, data: ArrayBuffer) => {
    if (sessionRef.current?.micEnabled) {
      sessionRef.current.feedMicAudio(Buffer.from(data));
    }
  });

  ipcMain.handle("toggle-translation", () => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    const enabled = sessionRef.current.toggleTranslation();
    return { ok: true, enabled };
  });

  ipcMain.handle("set-translation-mode", (_event, direction: string, targetLang?: string) => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    sessionRef.current.setTranslationMode(
      direction as "off" | "auto" | "source-target",
      targetLang as LanguageCode | undefined,
    );
    return { ok: true };
  });

  ipcMain.handle("add-context-note", (_event, text: string) => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    const trimmed = (text ?? "").trim();
    if (!trimmed) return { ok: false, error: "Empty note" };
    const block = sessionRef.current.addNote(trimmed);
    return { ok: true, block };
  });

  ipcMain.handle("list-mic-devices", async () => {
    try {
      return await listMicDevices();
    } catch {
      return [];
    }
  });

  ipcMain.handle("shutdown-session", async () => {
    await shutdownCurrentSession(sessionRef, db);
    return { ok: true };
  });

  ipcMain.handle("generate-final-summary", () => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    sessionRef.current.generateFinalSummary();
    return { ok: true };
  });

  ipcMain.handle("get-final-summary", (_event, sessionId: string) => {
    const summary = db.getFinalSummary(sessionId);
    return summary ? { ok: true, summary } : { ok: false };
  });

  ipcMain.handle("patch-final-summary", (_event, sessionId: string, patch: Partial<FinalSummary>) => {
    const existing = db.getFinalSummary(sessionId);
    if (!existing) return { ok: false };
    db.saveFinalSummary(sessionId, { ...existing, ...patch });
    return { ok: true };
  });

  ipcMain.handle("generate-agents-summary", () => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    sessionRef.current.generateAgentsSummary();
    return { ok: true };
  });

  ipcMain.handle("get-agents-summary", (_event, sessionId: string) => {
    const summary = db.getAgentsSummary(sessionId);
    return summary ? { ok: true, summary } : { ok: false };
  });
}
