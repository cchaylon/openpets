import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const maxLogBytes = 2 * 1024 * 1024;

let logFilePath: string | null = null;

export function initLogger(userDataPath: string): void {
  const logDirectory = join(userDataPath, "logs");
  mkdirSync(logDirectory, { recursive: true });
  logFilePath = join(logDirectory, "deskpet.log");
  rotateIfNeeded();
}

export function logInfo(scope: string, message: string, fields?: Record<string, unknown>): void {
  write("info", scope, message, fields);
}

export function logWarn(scope: string, message: string, fields?: Record<string, unknown>): void {
  write("warn", scope, message, fields);
}

export function logError(scope: string, message: string, fields?: Record<string, unknown>): void {
  write("error", scope, message, fields);
}

function write(level: "info" | "warn" | "error", scope: string, message: string, fields?: Record<string, unknown>): void {
  const entry = {
    time: new Date().toISOString(),
    level,
    scope,
    message,
    ...(fields ?? {}),
  };
  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  if (!logFilePath) {
    return;
  }
  try {
    appendFileSync(logFilePath, `${line}\n`, "utf8");
  } catch {
    // Logging must never take the app down.
  }
}

function rotateIfNeeded(): void {
  if (!logFilePath || !existsSync(logFilePath)) {
    return;
  }
  try {
    if (statSync(logFilePath).size <= maxLogBytes) {
      return;
    }
    renameSync(logFilePath, `${logFilePath}.1`);
  } catch {
    // Rotation is best effort.
  }
}
