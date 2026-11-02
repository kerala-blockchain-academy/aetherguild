import { listen } from "@tauri-apps/api/event";

export interface LogEntry {
  id: number;
  time: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  raw: string;
}

interface LogPayload {
  line: string;
  stream: string;
}

let logs = $state<LogEntry[]>([]);
let counter = 0;

function parseLevel(line: string): LogEntry["level"] {
  const u = line.toUpperCase();
  if (u.includes("WARN")) return "WARN";
  if (u.includes("ERROR") || u.includes("CRIT")) return "ERROR";
  if (u.includes("DEBUG") || u.includes("TRACE")) return "DEBUG";
  return "INFO";
}

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function getLogs(): LogEntry[] {
  return logs;
}

export function clearLogs() {
  logs = [];
}

export async function initLogListener() {
  try {
    await listen<LogPayload>("druid-log", (event) => {
      const line = event.payload.line.trimEnd();
      if (!line) return;
      logs.push({
        id: counter++,
        time: timestamp(),
        level: parseLevel(line),
        raw: line,
      });
      if (logs.length > 2000) logs.splice(0, logs.length - 2000);
    });
  } catch {
    // not in Tauri context
  }
}
