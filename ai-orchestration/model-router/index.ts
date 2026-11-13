import * as fs from "node:fs";
import { EchoProvider, Logger, Metrics, ModelProvider, ModelRouter, RetryPolicy, DEFAULT_RETRY } from "../../common/typescript/src";
import { SecretStore } from "../../security/secure-storage";
import { createAnthropicProvider } from "../../model-providers/anthropic";
import { createGeminiProvider } from "../../model-providers/google-gemini";
import { createOllamaProvider } from "../../model-providers/local-ollama";
import { createOpenAIProvider } from "../../model-providers/openai";
import { createCustomOpenAICompatible } from "../../model-providers/custom-api";

/** config/routing.json */
export interface RoutingConfig {
  /** Providers to enable, in fallback order. */
  providers: Array<"anthropic" | "openai" | "gemini" | "ollama" | "custom" | "echo">;
  default?: string;
  /** task -> provider (and optional model). */
  rules?: Record<string, { provider: string; model?: string }>;
  /** Force every request to the local model (air-gapped / regulated projects). */
  localOnly?: boolean;
  custom?: { baseUrl: string; model: string };
  retry?: Partial<RetryPolicy>;
}

export const DEFAULT_ROUTING: RoutingConfig = {
  providers: ["anthropic", "openai", "gemini", "ollama", "echo"],
  rules: {
    "code-generation": { provider: "anthropic" },
    "code-review": { provider: "anthropic" },
    summarize: { provider: "openai" },
    "quick-answer": { provider: "openai" },
  },
};

export function loadRoutingConfig(file: string): RoutingConfig {
  return fs.existsSync(file) ? { ...DEFAULT_ROUTING, ...JSON.parse(fs.readFileSync(file, "utf8")) } : DEFAULT_ROUTING;
}

/**
 * Builds the platform router from routing.json + the SecretStore. Providers without a key are skipped
 * (reported in `skipped`), so the IDE still starts. localOnly keeps everything on Ollama.
 */
export function buildRouter(cfg: RoutingConfig, secrets: SecretStore, logger = new Logger("router")): { router: ModelRouter; skipped: string[] } {
  const router = new ModelRouter(logger, new Metrics(), { ...DEFAULT_RETRY, ...cfg.retry });
  const skipped: string[] = [];
  const names = cfg.localOnly ? ["ollama"] : cfg.providers;
  const factories: Record<string, () => ModelProvider> = {
    anthropic: () => createAnthropicProvider(secrets),
    openai: () => createOpenAIProvider(secrets),
    gemini: () => createGeminiProvider(secrets),
    ollama: () => createOllamaProvider(),
    custom: () => {
      if (!cfg.custom) throw new Error("custom provider needs custom.baseUrl and custom.model");
      return createCustomOpenAICompatible("custom", cfg.custom.baseUrl, cfg.custom.model, secrets);
    },
    echo: () => new EchoProvider(),
  };
  for (const n of names) {
    try {
      router.register(factories[n](), { isLocal: n === "ollama" });
    } catch (e) {
      skipped.push(`${n}: ${(e as Error).message}`);
    }
  }
  if (!router.listProviders().length) router.register(new EchoProvider());
  if (cfg.default && router.listProviders().includes(cfg.default)) router.setDefault(cfg.default);
  for (const [task, r] of Object.entries(cfg.rules ?? {})) router.addRule({ task, provider: r.provider, model: r.model });
  return { router, skipped };
}
