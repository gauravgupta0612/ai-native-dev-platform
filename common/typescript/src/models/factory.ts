import { PlatformConfig } from "../config/config";
import { Logger } from "../observability/logger";
import { DEFAULT_RETRY, ModelRouter } from "./router";
import { Metrics } from "../observability/metrics";
import { AnthropicProvider } from "./providers/anthropic";
import { EchoProvider } from "./providers/echo";
import { GeminiProvider } from "./providers/gemini";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

/**
 * Builds a router with every provider that has settings.
 * The offline "echo" provider is always added last so the app still runs without keys.
 */
export function createRouter(cfg: PlatformConfig, logger = new Logger("platform")): ModelRouter {
  const router = new ModelRouter(logger.child("router"), new Metrics(), { ...DEFAULT_RETRY, maxRetries: cfg.maxRetries });
  if (cfg.anthropic.apiKey) {
    router.register(new AnthropicProvider({ apiKey: cfg.anthropic.apiKey, defaultModel: cfg.anthropic.model, baseUrl: cfg.anthropic.baseUrl }));
  }
  if (cfg.openai.apiKey) {
    router.register(new OpenAICompatibleProvider({ name: "openai", baseUrl: cfg.openai.baseUrl, apiKey: cfg.openai.apiKey, defaultModel: cfg.openai.model }));
  }
  if (cfg.gemini.apiKey) {
    router.register(new GeminiProvider({ apiKey: cfg.gemini.apiKey, defaultModel: cfg.gemini.model, baseUrl: cfg.gemini.baseUrl }));
  }
  if (cfg.ollama.enabled) {
    router.register(
      new OpenAICompatibleProvider({ name: "ollama", baseUrl: `${cfg.ollama.baseUrl.replace(/\/+$/, "")}/v1`, defaultModel: cfg.ollama.model }),
      { isLocal: true },
    );
  }
  if (cfg.custom.baseUrl) {
    router.register(new OpenAICompatibleProvider({ name: "custom", baseUrl: cfg.custom.baseUrl, apiKey: cfg.custom.apiKey, defaultModel: cfg.custom.model }));
  }
  router.register(new EchoProvider());
  if (cfg.defaultProvider !== "auto" && router.listProviders().includes(cfg.defaultProvider)) {
    router.setDefault(cfg.defaultProvider);
  }
  return router;
}
