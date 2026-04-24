import type { BrowserWindow } from "electron";
import type { AppDatabase } from "@core/db/db";
import { Session } from "@core/session";
import type {
  Agent,
  AgentStep,
  AgentsSummary,
  AppConfigOverrides,
  Direction,
  FinalSummary,
  LanguageCode,
  ProviderTaskEvent,
  SessionConfig,
  Summary,
  TaskItem,
  TaskSuggestion,
  TranscriptBlock,
  UIState,
} from "@core/types";
import { normalizeAppConfig } from "@core/types";
import type { SessionRef } from "./types";
import { log } from "@core/logger";

export function sendToRenderer(
  getWindow: () => BrowserWindow | null,
  channel: string,
  ...args: unknown[]
) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

export function buildSessionConfig(
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  appConfig?: AppConfigOverrides,
  options?: {
    direction?: Direction;
    translationEnabled?: boolean;
  },
): SessionConfig {
  const config = normalizeAppConfig(appConfig);
  return {
    direction: options?.direction ?? config.direction,
    sourceLang,
    targetLang,
    intervalMs: config.intervalMs,
    transcriptionProvider: config.transcriptionProvider,
    transcriptionModelId: config.transcriptionModelId,
    analysisProvider: config.analysisProvider,
    analysisModelId: config.analysisModelId,
    analysisProviderOnly: config.analysisProviderOnly,
    analysisReasoning: config.analysisReasoning,
    taskModelId: config.taskModelId,
    taskProviders: config.taskProviders,
    utilityModelId: config.utilityModelId,
    synthesisModelId: config.synthesisModelId,
    responseLength: config.responseLength,
    taskSuggestionAggressiveness: config.taskSuggestionAggressiveness,
    suggestionScanWordBudget: config.suggestionScanWordBudget,
    debug: config.debug,
    legacyAudio: config.legacyAudio,
    translationEnabled: options?.translationEnabled ?? false,
    agentAutoApprove: config.agentAutoApprove,
    localToolsFiles: config.localToolsFiles,
    localToolsBash: config.localToolsBash,
    localToolsRunJs: config.localToolsRunJs,
    codingAgent: config.codingAgent,
    disabledSkillIds: config.disabledSkillIds,
    learningEnabled: config.learningEnabled,
  };
}

export function wireSessionEvents(
  sessionRef: SessionRef,
  activeSession: Session,
  getWindow: () => BrowserWindow | null,
  db: AppDatabase,
) {
  const isCurrentSession = () => sessionRef.current?.sessionId === activeSession.sessionId;

  activeSession.events.on("state-change", (state: UIState) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:state-change", state);
  });
  activeSession.events.on("block-added", (block: TranscriptBlock) => {
    if (!isCurrentSession()) return;
    db.insertBlock(activeSession.sessionId, block);
    sendToRenderer(getWindow, "session:block-added", block);
  });
  activeSession.events.on("block-updated", (block: TranscriptBlock) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:block-updated", block);
  });
  activeSession.events.on("blocks-cleared", () => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:blocks-cleared");
  });
  activeSession.events.on("summary-updated", (summary: Summary | null) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:summary-updated", summary);
  });
  activeSession.events.on("cost-updated", (cost: number) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:cost-updated", cost);
  });
  activeSession.events.on("partial", (payload) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:partial", payload);
  });
  activeSession.events.on("status", (text: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:status", text);
  });
  activeSession.events.on("error", (text: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:error", text);
  });
  activeSession.events.on("task-added", (task: TaskItem) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:task-added", task);
  });
  activeSession.events.on("task-suggested", (suggestion: TaskSuggestion) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:task-suggested", suggestion);
  });
  activeSession.events.on("suggestion-progress", (payload) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:suggestion-progress", payload);
  });
  activeSession.events.on("agent-started", (agent: Agent) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agent-started", agent);
  });
  activeSession.events.on("agent-step", (agentId: string, step: AgentStep) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agent-step", agentId, step);
  });
  activeSession.events.on("agent-completed", (agentId: string, result: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agent-completed", agentId, result);
  });
  activeSession.events.on("agent-failed", (agentId: string, error: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agent-failed", agentId, error);
  });
  activeSession.events.on("agent-archived", (agentId: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agent-archived", agentId);
  });
  activeSession.events.on("final-summary-ready", (summary: FinalSummary) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:final-summary-ready", summary);
  });
  activeSession.events.on("final-summary-error", (error: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:final-summary-error", error);
  });
  activeSession.events.on("agents-summary-ready", (summary: AgentsSummary) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agents-summary-ready", summary);
  });
  activeSession.events.on("agents-summary-error", (error: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agents-summary-error", error);
  });
  activeSession.events.on("session-title-generated", (sessionId: string, title: string) => {
    db.updateSessionTitle(sessionId, title);
    sendToRenderer(getWindow, "session:title-generated", sessionId, title);
  });
  activeSession.events.on("agent-title-generated", (agentId: string, title: string) => {
    sendToRenderer(getWindow, "session:agent-title-generated", agentId, title);
  });
  activeSession.events.on("provider-task-event", (event: ProviderTaskEvent) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:provider-task-event", event);
  });
}

export async function shutdownCurrentSession(sessionRef: SessionRef, db: AppDatabase): Promise<void> {
  if (sessionRef.current) {
    const activeSession = sessionRef.current;
    log("INFO", `Shutting down active session: ${activeSession.sessionId}`);
    try {
      await activeSession.shutdown();
    } finally {
      if (sessionRef.current?.sessionId === activeSession.sessionId) {
        sessionRef.current = null;
      }
      db.endSession(activeSession.sessionId);
    }
  }
}
