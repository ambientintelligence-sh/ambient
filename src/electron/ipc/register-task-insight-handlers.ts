import { ipcMain } from "electron";
import type { AppConfigOverrides, TaskItem } from "@core/types";
import { log } from "@core/logger";
import type { EnsureSession, IpcDeps } from "./types";
import { sendToRenderer } from "./ipc-utils";

type TaskInsightDeps = IpcDeps & {
  ensureSession: EnsureSession;
};

export function registerTaskInsightHandlers({
  db,
  getWindow,
  ensureSession,
  sessionRef,
}: TaskInsightDeps) {
  const broadcastTasksChanged = (sessionId?: string | null, changedTaskId?: string) => {
    if (!sessionId) return;
    sendToRenderer(
      getWindow,
      "session:tasks-changed",
      sessionId,
      db.getTasksForSession(sessionId),
      db.getArchivedTasksForSession(sessionId),
      changedTaskId,
    );
  };

  const buildTaskClassifierInput = (title: string, details?: string) => {
    const trimmedTitle = title.trim();
    const trimmedDetails = details?.trim();
    if (!trimmedDetails) return trimmedTitle;
    return `${trimmedTitle}\n\nContext:\n${trimmedDetails}`;
  };

  const classifyAsLarge = (reason: string) => ({
    size: "large" as const,
    reason,
  });

  const classifyTask = async (
    text: string,
    sessionId?: string,
    appConfig?: AppConfigOverrides,
  ) => {
    if (!sessionId) return classifyAsLarge("Missing session id for classifier");

    const ensured = await ensureSession(sessionId, appConfig);
    if (ensured.ok === false) {
      const message = ensured.error;
      log("WARN", `Task classifier fallback (ensure session failed): ${message}`);
      return classifyAsLarge("Could not initialize classifier session");
    }

    if (!sessionRef.current) {
      return classifyAsLarge("Classifier session unavailable");
    }

    return sessionRef.current.classifyTaskSize(text);
  };

  ipcMain.handle("get-tasks", () => {
    return db.getTasks();
  });

  ipcMain.handle("get-session-tasks", (_event, sessionId: string) => {
    return db.getTasksForSession(sessionId);
  });

  ipcMain.handle("add-task", async (_event, task: TaskItem, appConfig?: AppConfigOverrides) => {
    const text = task.text.trim();
    if (!text) return { ok: false, error: "Task text is required" };
    const details = task.details?.trim();

    const classification = await classifyTask(
      buildTaskClassifierInput(text, details),
      task.sessionId,
      appConfig,
    );
    const persistedTask: TaskItem = {
      ...task,
      text,
      details: details || undefined,
      size: classification.size,
    };

    if (db.getTask(task.id)) {
      db.updateTaskRecord(persistedTask);
    } else {
      db.insertTask(persistedTask);
    }
    broadcastTasksChanged(persistedTask.sessionId, persistedTask.id);
    return { ok: true, task: persistedTask };
  });

  ipcMain.handle(
    "update-task-text",
    async (_event, id: string, text: string, appConfig?: AppConfigOverrides) => {
      const existing = db.getTask(id);
      if (!existing) return { ok: false, error: "Task not found" };

      const trimmed = text.trim();
      if (!trimmed) return { ok: false, error: "Task text is required" };

      const classification = await classifyTask(
        buildTaskClassifierInput(trimmed, existing.details),
        existing.sessionId,
        appConfig,
      );
      db.updateTaskText(id, trimmed, classification.size);
      broadcastTasksChanged(existing.sessionId, id);

      return {
        ok: true,
        task: {
          ...existing,
          text: trimmed,
          size: classification.size,
        },
      };
    },
  );

  ipcMain.handle("toggle-task", (_event, id: string) => {
    const tasks = db.getTasks();
    const task = tasks.find((item) => item.id === id);
    if (!task) return { ok: false, error: "Task not found" };
    db.updateTask(id, !task.completed);
    broadcastTasksChanged(task.sessionId, id);
    return { ok: true };
  });

  ipcMain.handle("delete-task", (_event, id: string) => {
    const task = db.getTask(id);
    if (!task) return { ok: false, error: "Task not found" };
    db.deleteTask(id);
    broadcastTasksChanged(task.sessionId, id);
    return { ok: true };
  });

  ipcMain.handle(
    "extract-task-from-selection-in-session",
    async (
      _event,
      sessionId: string,
      selectedText: string,
      userIntentText?: string,
      appConfig?: AppConfigOverrides,
    ) => {
      const trimmedSelection = selectedText.trim();
      if (!trimmedSelection) return { ok: false, error: "Selected text is required" };

      const ensured = await ensureSession(sessionId, appConfig);
      if (!ensured.ok) return ensured;
      if (!sessionRef.current) return { ok: false, error: "Could not load session" };
      return sessionRef.current.extractTaskFromSelection(trimmedSelection, userIntentText);
    },
  );

  ipcMain.handle("get-sessions", (_event, limit?: number) => {
    return db.getSessions(limit);
  });

  ipcMain.handle("get-session-blocks", (_event, sessionId: string) => {
    return db.getBlocksForSession(sessionId);
  });

  ipcMain.handle("delete-session", (_event, id: string) => {
    db.deleteSession(id);
    return { ok: true };
  });

  ipcMain.handle("archive-task", (_event, id: string) => {
    const task = db.getTask(id);
    if (!task) return { ok: false, error: "Task not found" };
    db.archiveTask(id);
    broadcastTasksChanged(task.sessionId, id);
    return { ok: true };
  });

  ipcMain.handle("unarchive-task", (_event, id: string) => {
    const task = db.getTask(id);
    if (!task) return { ok: false, error: "Task not found" };
    db.unarchiveTask(id);
    broadcastTasksChanged(task.sessionId, id);
    return { ok: true };
  });

  ipcMain.handle("get-archived-tasks", (_event, sessionId: string) => {
    return db.getArchivedTasksForSession(sessionId);
  });

  ipcMain.handle("get-insights", (_event, limit?: number) => {
    return db.getRecentInsights(limit);
  });

  ipcMain.handle("get-session-insights", (_event, sessionId: string) => {
    return db.getInsightsForSession(sessionId);
  });
}
