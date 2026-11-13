import { redactSecrets } from "../security/guardrails";

export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogSink = (line: string) => void;

/**
 * Structured JSON-line logger. Level from LOG_LEVEL env (default "info").
 * Every line passes through redactSecrets(), so API keys and tokens never reach the logs.
 */
export class Logger {
  static sink: LogSink = (line) => console.error(line);
  private readonly level: LogLevel;

  constructor(private readonly component: string, level?: LogLevel) {
    const env = (typeof process !== "undefined" ? process.env.LOG_LEVEL : undefined) as LogLevel | undefined;
    this.level = level ?? (env && env in ORDER ? env : "info");
  }

  child(component: string): Logger {
    return new Logger(`${this.component}.${component}`, this.level);
  }

  debug(msg: string, data?: Record<string, unknown>) { this.log("debug", msg, data); }
  info(msg: string, data?: Record<string, unknown>) { this.log("info", msg, data); }
  warn(msg: string, data?: Record<string, unknown>) { this.log("warn", msg, data); }
  error(msg: string, data?: Record<string, unknown>) { this.log("error", msg, data); }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
    if (ORDER[level] < ORDER[this.level]) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, component: this.component, msg, ...data });
    Logger.sink(redactSecrets(line, false));
  }
}
