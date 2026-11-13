import { existsSync, readFileSync } from "node:fs";

/** All settings come from environment variables (or a local .env file). Never hard-code keys. */
export interface PlatformConfig {
  defaultProvider: string;
  openai: { apiKey?: string; baseUrl: string; model: string };
  anthropic: { apiKey?: string; baseUrl: string; model: string };
  gemini: { apiKey?: string; baseUrl: string; model: string };
  ollama: { baseUrl: string; model: string; enabled: boolean };
  custom: { baseUrl?: string; apiKey?: string; model: string };
  auditLogPath?: string;
  maxAgentSteps: number;
}

/** Parses KEY=VALUE lines. Existing environment variables win over the file. */
export function loadDotEnv(path = ".env", env: Record<string, string | undefined> = process.env): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): PlatformConfig {
  const v = (k: string) => (env[k] && env[k]!.trim() ? env[k]!.trim() : undefined);
  return {
    defaultProvider: v("DEFAULT_PROVIDER") ?? "auto",
    openai: {
      apiKey: v("OPENAI_API_KEY"),
      baseUrl: v("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
      model: v("OPENAI_MODEL") ?? "gpt-4o-mini",
    },
    anthropic: {
      apiKey: v("ANTHROPIC_API_KEY"),
      baseUrl: v("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com",
      model: v("ANTHROPIC_MODEL") ?? "claude-sonnet-4-5",
    },
    gemini: {
      apiKey: v("GEMINI_API_KEY"),
      baseUrl: v("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta",
      model: v("GEMINI_MODEL") ?? "gemini-2.5-flash",
    },
    ollama: {
      baseUrl: v("OLLAMA_BASE_URL") ?? "http://localhost:11434",
      model: v("OLLAMA_MODEL") ?? "llama3.1",
      enabled: (v("OLLAMA_ENABLED") ?? "false").toLowerCase() === "true",
    },
    custom: { baseUrl: v("CUSTOM_API_URL"), apiKey: v("CUSTOM_API_KEY"), model: v("CUSTOM_MODEL") ?? "default" },
    auditLogPath: v("AUDIT_LOG_PATH"),
    maxAgentSteps: Number(v("MAX_AGENT_STEPS") ?? 8),
  };
}
