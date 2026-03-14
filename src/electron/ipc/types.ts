import type { BrowserWindow } from "electron";
import type { AppDatabase } from "@core/db/db";
import type { Session } from "@core/session";
import type { AppConfigOverrides } from "@core/types";

export type EnsureSessionResult = { ok: true } | { ok: false; error: string };

export type EnsureSession = (
  sessionId: string,
  appConfig?: AppConfigOverrides,
) => Promise<EnsureSessionResult>;

export type SessionRef = {
  current: Session | null;
};

export type IpcDeps = {
  db: AppDatabase;
  getWindow: () => BrowserWindow | null;
  sessionRef: SessionRef;
};
