import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveLogDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron");
    return app.getPath("userData");
  } catch {
    return os.tmpdir();
  }
}

let logFile: string | null = null;

function getLogFile(): string {
  if (!logFile) {
    logFile = path.join(resolveLogDir(), "ambient.log");
  }
  return logFile;
}

export function log(level: "INFO" | "ERROR" | "WARN", msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level}: ${msg}\n`;
  try {
    fs.appendFileSync(getLogFile(), line);
  } catch {
    // Silently ignore log write failures (e.g. during early startup)
  }
  console.log(line);
}
