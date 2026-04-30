import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import "dotenv/config";
import { registerIpcHandlers, shutdownSessionOnAppQuit, getActiveSessionId, getActiveSessionState } from "./ipc-handlers";
import { disposeRunJsRuntime } from "@core/agents/run-js-tool";
import { createDatabase, type AppDatabase } from "@core/db/db";
import { seedDemoData } from "@core/db/seed-demo";
import { log } from "@core/logger";
import { SecureCredentialStore } from "./integrations/secure-credential-store";
import { checkForUpdate, type UpdateInfo } from "@core/update-checker";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let popupWindow: BrowserWindow | null = null;
let popupSessionId: string | null = null;
let db: AppDatabase | null = null;
let wasSeeded = false;

function broadcastPopupState() {
  const payload = { open: popupWindow !== null, sessionId: popupSessionId };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("popup:state-change", payload);
    }
  }
}

function syncPopupVisibilityForMainFocus() {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  if (mainWindow?.isFocused()) {
    popupWindow.hide();
    return;
  }
  if (!popupWindow.isVisible()) {
    popupWindow.showInactive();
  }
}

function loadRenderer(win: BrowserWindow, hash?: string) {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = hash ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${hash}` : MAIN_WINDOW_VITE_DEV_SERVER_URL;
    win.loadURL(url);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      hash ? { hash } : undefined,
    );
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    acceptFirstMouse: true,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0A0A0A",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setBackgroundThrottling(false);
  loadRenderer(mainWindow);

  if (process.env.NODE_ENV === "development" || MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    log("ERROR", `Main renderer gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on("unresponsive", () => {
    log("WARN", "Main renderer unresponsive");
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    closePopupWindow();
  });
  mainWindow.on("focus", syncPopupVisibilityForMainFocus);
  mainWindow.on("blur", syncPopupVisibilityForMainFocus);
}

const POPUP_WIDTH = 380;
const POPUP_MIN_HEIGHT = 40;

export function openPopupWindow(sessionId: string | null) {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.focus();
    return;
  }

  popupSessionId = sessionId;

  popupWindow = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_MIN_HEIGHT,
    minWidth: 320,
    minHeight: POPUP_MIN_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    acceptFirstMouse: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  popupWindow.webContents.setBackgroundThrottling(false);
  popupWindow.setHasShadow(false);
  popupWindow.setAlwaysOnTop(true, "floating");
  popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const hash = sessionId ? `popup?sessionId=${encodeURIComponent(sessionId)}` : "popup";
  loadRenderer(popupWindow, hash);

  // Keep the main window available. The popup is a companion workflow surface,
  // not a replacement for the full Ambient app.
  popupWindow.webContents.on("render-process-gone", (_e, details) => {
    log("ERROR", `Popup renderer gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  popupWindow.webContents.on("unresponsive", () => {
    log("WARN", "Popup renderer unresponsive");
  });

  popupWindow.on("closed", () => {
    popupWindow = null;
    popupSessionId = null;
    broadcastPopupState();
  });
  popupWindow.on("blur", syncPopupVisibilityForMainFocus);

  broadcastPopupState();
}

export function closePopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.close();
  }
}

export function getPopupSnapshotState() {
  return { open: popupWindow !== null, sessionId: popupSessionId };
}

app.whenReady().then(async () => {
  const userData = app.getPath("userData");

  // Load encrypted API keys into process.env before anything else
  const store = new SecureCredentialStore(
    path.join(userData, "integrations.credentials.json"),
  );
  if (store.encryptionAvailable()) {
    const storedKeys = await store.getAllApiKeys();
    for (const [envVar, value] of Object.entries(storedKeys)) {
      process.env[envVar] = value;
      if (envVar === "GEMINI_API_KEY") {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = value;
      }
    }
  }

  const dbPath = path.join(userData, "ambient.db");
  db = createDatabase(dbPath);

  // Auto-seed demo data on first launch (empty DB)
  const existingSessions = db.getSessions(1);
  if (existingSessions.length === 0) {
    seedDemoData(db.raw);
    wasSeeded = true;
  }

  const staleAgentCount = db.failStaleRunningAgents("Interrupted because the app quit before completion.");
  if (staleAgentCount > 0) {
    log("WARN", `Recovered ${staleAgentCount} stale running agent(s) as failed on startup`);
  }

  ipcMain.handle("was-seeded", () => wasSeeded);
  ipcMain.handle("check-for-update", async (): Promise<UpdateInfo | null> => {
    return checkForUpdate(app.getVersion(), "investor55/ambient");
  });
  ipcMain.handle("popup:open", (_event, sessionId: string | null) => {
    openPopupWindow(sessionId ?? null);
  });
  ipcMain.handle("popup:close", () => {
    closePopupWindow();
  });
  ipcMain.handle("app:open-agent", (_event, sessionId: string, agentId: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("app:open-agent", sessionId, agentId);
    }
  });
  ipcMain.handle("popup:get-state", () => getPopupSnapshotState());
  ipcMain.handle("session:get-active-id", () => getActiveSessionId());
  ipcMain.handle("session:get-state", () => getActiveSessionState());
  ipcMain.on("log:renderer", (event, level: "WARN" | "ERROR", msg: string) => {
    const isPopup = popupWindow && !popupWindow.isDestroyed() && event.sender.id === popupWindow.webContents.id;
    const tag = isPopup ? "popup" : "main-renderer";
    log(level, `[${tag}] ${msg}`);
  });
  ipcMain.handle("popup:resize-height", (_event, height: number) => {
    if (!popupWindow || popupWindow.isDestroyed()) return;
    const target = Math.max(POPUP_MIN_HEIGHT, Math.round(height));
    const bounds = popupWindow.getBounds();
    popupWindow.setBounds({ x: bounds.x, y: bounds.y, width: POPUP_WIDTH, height: target }, true);
  });
  ipcMain.handle("popup:hydrate", async (_event, sessionId: string) => {
    if (!db) return { tasks: [], agents: [], archivedTasks: [] };
    const [tasks, agents, archivedTasks] = await Promise.all([
      Promise.resolve(db.getTasksForSession(sessionId)),
      Promise.resolve(db.getAgentsForSession(sessionId)),
      Promise.resolve(db.getArchivedTasksForSession(sessionId)),
    ]);
    return { tasks, agents, archivedTasks };
  });
  registerIpcHandlers(() => mainWindow, db);
  createWindow();

  // Check for updates after renderer is ready
  mainWindow?.webContents.once("did-finish-load", async () => {
    const update = await checkForUpdate(app.getVersion(), "investor55/ambient");
    if (update) {
      mainWindow?.webContents.send("app:update-available", update);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  shutdownSessionOnAppQuit();
  void disposeRunJsRuntime();
  db?.close();
  db = null;
});

app.on("window-all-closed", () => {
  app.quit();
});
