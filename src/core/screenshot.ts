import { app, desktopCapturer, screen, shell, systemPreferences } from "electron";

export type ScreenshotResult =
  | {
      ok: true;
      data: string;
      mimeType: "image/png";
      width: number;
      height: number;
      displayLabel: string;
    }
  | {
      ok: false;
      error: string;
      permissionRequired?: boolean;
    };

let openedSettingsThisRun = false;

function openScreenRecordingSettings(): void {
  if (process.platform !== "darwin") return;
  if (openedSettingsThisRun) return;
  openedSettingsThisRun = true;
  void shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  );
}

/**
 * Capture a single screenshot of the primary display at full native resolution.
 *
 * macOS Screen Recording is a TCC permission. The runtime prompt only fires the
 * FIRST time a process calls a screen-capture API while status is `not-determined`.
 * If the user has previously denied access, no prompt fires — we have to bounce
 * them to System Settings ourselves.
 *
 * Strategy:
 * - Don't pre-gate on `getMediaAccessStatus`; let `desktopCapturer.getSources` run
 *   so it can trigger the implicit prompt on first use.
 * - If the resulting image is empty OR status is denied/restricted, return a clean
 *   error AND open the Privacy > Screen Recording pane so the user lands there
 *   instead of having to find it.
 */
export async function captureScreenshot(): Promise<ScreenshotResult> {
  const isDarwin = process.platform === "darwin";
  const preStatus = isDarwin ? systemPreferences.getMediaAccessStatus("screen") : "granted";

  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  const scale = primary.scaleFactor || 1;

  let sources: Awaited<ReturnType<typeof desktopCapturer.getSources>> = [];
  let getSourcesError: unknown = null;
  try {
    sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
      fetchWindowIcons: false,
    });
  } catch (error) {
    getSourcesError = error;
  }

  const primaryId = String(primary.id);
  const source = sources.find((s) => s.display_id === primaryId) ?? sources[0];

  // Re-check status *after* the call — macOS may have just shown the prompt.
  const postStatus = isDarwin ? systemPreferences.getMediaAccessStatus("screen") : "granted";

  if (!source || (source.thumbnail && source.thumbnail.isEmpty())) {
    if (isDarwin && (postStatus === "denied" || postStatus === "restricted" || postStatus === "not-determined")) {
      openScreenRecordingSettings();
      const appPath = app.getPath("exe");
      const isDev = !app.isPackaged;
      const targetForUser = isDev
        ? `the Electron binary at:\n  ${appPath}\n(In the file picker: Cmd-Shift-G, paste that path, hit Open.)`
        : `Ambient.app`;
      return {
        ok: false,
        permissionRequired: true,
        error:
          `Screen Recording permission is missing for this process. I opened System Settings > Privacy & Security > Screen & System Audio Recording. ` +
          `Add ${targetForUser} to the TOP list (\"Screen & System Audio Recording\"), then FULLY QUIT and relaunch the app — TCC permissions only take effect after restart. ` +
          `Note: \"Ambient\" already in the bottom \"System Audio Recording Only\" list is a different permission and does NOT cover screenshots.`,
      };
    }
    if (getSourcesError) {
      return {
        ok: false,
        error: `desktopCapturer.getSources failed: ${getSourcesError instanceof Error ? getSourcesError.message : String(getSourcesError)}`,
      };
    }
    return { ok: false, error: "No screen source available." };
  }

  if (isDarwin && (preStatus === "denied" || preStatus === "restricted")) {
    // We somehow got an image despite a denied status — extremely unlikely, but
    // fall through and use it.
  }

  const png = source.thumbnail.toPNG();
  const size = source.thumbnail.getSize();
  return {
    ok: true,
    data: png.toString("base64"),
    mimeType: "image/png",
    width: size.width,
    height: size.height,
    displayLabel: source.name || "Primary display",
  };
}
