// Thin wrapper around the preload-exposed renderer logger so any window can
// forward structured log lines into the main process log file (ambient.log).
// Falls back to console if the bridge is unavailable (e.g. during early boot).

type Level = "WARN" | "ERROR";

const LEVEL_PRIORITY: Record<Level, number> = { WARN: 20, ERROR: 30 };
const MIN_LEVEL: Level = "WARN";

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function rlog(level: Level, msg: string, extra?: unknown): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return;
  const line = extra === undefined ? msg : `${msg} ${safeStringify(extra)}`;
  try {
    window.electronAPI?.logRenderer(level, line);
  } catch {
    // ignore
  }
  if (level === "ERROR") {
    console.error(`[${level}] ${line}`);
  } else if (level === "WARN") {
    console.warn(`[${level}] ${line}`);
  }
}

export function installRendererErrorHooks(tag: string): void {
  window.addEventListener("error", (event) => {
    rlog("ERROR", `${tag} window error: ${event.message}`, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    rlog("ERROR", `${tag} unhandled rejection`, event.reason);
  });
}
