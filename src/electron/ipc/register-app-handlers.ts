import { app, ipcMain, shell, systemPreferences } from "electron";
import {
  captureScreenshot,
  getScreenRecordingPermissionStatus,
  type MediaAccessStatus,
  openScreenRecordingSettings,
} from "@core/screenshot";

export type MacPermissionName = "microphone" | "screen";
export type MacPermissionStatus = MediaAccessStatus | "unsupported";

export type AppPermissionStatus = {
  platform: NodeJS.Platform;
  microphone: MacPermissionStatus;
  screen: MacPermissionStatus;
};

let registered = false;

function getMicrophonePermissionStatus(): MacPermissionStatus {
  if (process.platform !== "darwin") return "unsupported";
  return systemPreferences.getMediaAccessStatus("microphone");
}

function getAppPermissionStatus(): AppPermissionStatus {
  return {
    platform: process.platform,
    microphone: getMicrophonePermissionStatus(),
    screen: process.platform === "darwin" ? getScreenRecordingPermissionStatus() : "unsupported",
  };
}

function openMicrophoneSettings(): void {
  if (process.platform !== "darwin") return;
  void shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  );
}

export function registerAppHandlers() {
  if (registered) return;
  registered = true;

  ipcMain.handle("app:get-login-item-status", () => app.getLoginItemSettings());
  ipcMain.handle("app:set-open-at-login", (_event, openAtLogin: boolean) => {
    app.setLoginItemSettings({ openAtLogin });
    return app.getLoginItemSettings();
  });

  ipcMain.handle("app:get-permission-status", () => getAppPermissionStatus());
  ipcMain.handle("app:request-permission", async (_event, name: MacPermissionName) => {
    if (process.platform !== "darwin") {
      return { ok: true, status: getAppPermissionStatus() };
    }

    if (name === "microphone") {
      await systemPreferences.askForMediaAccess("microphone");
      return { ok: true, status: getAppPermissionStatus() };
    }

    const result = await captureScreenshot();
    if (result.ok === false) {
      return {
        ok: false,
        error: result.error,
        status: getAppPermissionStatus(),
      };
    }
    return { ok: true, status: getAppPermissionStatus() };
  });

  ipcMain.handle("app:open-permission-settings", (_event, name: MacPermissionName) => {
    if (name === "microphone") {
      openMicrophoneSettings();
    } else {
      openScreenRecordingSettings(true);
    }
    return { ok: true };
  });
}
