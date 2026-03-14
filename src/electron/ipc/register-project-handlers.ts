import { ipcMain } from "electron";
import type { IpcDeps } from "./types";

export function registerProjectHandlers({ db }: Pick<IpcDeps, "db">) {
  ipcMain.handle("get-projects", () => {
    return db.getProjects();
  });

  ipcMain.handle("create-project", (_event, name: string, instructions?: string, context?: string) => {
    if (!name?.trim()) {
      return { ok: false, error: "Project name is required" };
    }
    const project = db.createProject(crypto.randomUUID(), name.trim(), instructions?.trim() || undefined, context?.trim() || undefined);
    return { ok: true, project };
  });

  ipcMain.handle("update-project", (_event, id: string, patch: { name?: string; instructions?: string; context?: string }) => {
    const project = db.updateProject(id, patch);
    if (!project) {
      return { ok: false, error: "Project not found" };
    }
    return { ok: true, project };
  });

  ipcMain.handle("delete-project", (_event, id: string) => {
    db.deleteProject(id);
    return { ok: true };
  });

  ipcMain.handle("update-session-project", (_event, sessionId: string, projectId: string | null) => {
    const session = db.getSession(sessionId);
    if (!session) {
      return { ok: false, error: "Session not found" };
    }

    const normalizedProjectId = projectId?.trim() || null;
    if (normalizedProjectId) {
      const project = db.getProject(normalizedProjectId);
      if (!project) {
        return { ok: false, error: "Project not found" };
      }
    }

    const updated = db.updateSessionProject(sessionId, normalizedProjectId);
    if (!updated) {
      return { ok: false, error: "Session not found" };
    }

    return { ok: true, session: updated };
  });
}
