import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import "dotenv/config";
import { registerIpcHandlers, shutdownSessionOnAppQuit } from "./ipc-handlers";
import { createDatabase, type AppDatabase } from "@core/db/db";
import { seedDemoData } from "@core/db/seed-demo";
import { log } from "@core/logger";
import { SecureCredentialStore } from "./integrations/secure-credential-store";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let db: AppDatabase | null = null;
let wasSeeded = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    acceptFirstMouse: true,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#FAFAF8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  if (process.env.NODE_ENV === "development" || MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
    if (Object.keys(storedKeys).length > 0) {
      log("INFO", `Loaded ${Object.keys(storedKeys).length} stored API key(s)`);
    }
  }

  const dbPath = path.join(userData, "ambient.db");
  db = createDatabase(dbPath);

  // Auto-seed demo data on first launch (empty DB)
  const existingSessions = db.getSessions(1);
  if (existingSessions.length === 0) {
    seedDemoData(db.raw);
    wasSeeded = true;
    log("INFO", "Seeded demo data for first-time user");
  }

  const staleAgentCount = db.failStaleRunningAgents("Interrupted because the app quit before completion.");
  if (staleAgentCount > 0) {
    log("WARN", `Recovered ${staleAgentCount} stale running agent(s) as failed on startup`);
  }

  ipcMain.handle("was-seeded", () => wasSeeded);
  registerIpcHandlers(() => mainWindow, db);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  shutdownSessionOnAppQuit();
  db?.close();
  db = null;
});

app.on("window-all-closed", () => {
  app.quit();
});
