import { ChatResponse, ModelProvider } from "../../common/typescript/src";

export type { ModelProvider, ChatRequest, ChatResponse } from "../../common/typescript/src";

export interface ProviderInfo {
  name: string;
  displayName: string;
  local: boolean;
  supportsTools: boolean;
  /** USD per 1M tokens, for cost estimates only. Update to your contract prices. */
  pricing?: { input: number; output: number };
}

/** Catalogue shown in the IDE's model picker and used by cost reports. */
export const PROVIDER_CATALOG: Record<string, ProviderInfo> = {
  openai: { name: "openai", displayName: "OpenAI (ChatGPT)", local: false, supportsTools: true, pricing: { input: 0.15, output: 0.6 } },
  anthropic: { name: "anthropic", displayName: "Anthropic (Claude)", local: false, supportsTools: true, pricing: { input: 3, output: 15 } },
  gemini: { name: "gemini", displayName: "Google (Gemini)", local: false, supportsTools: false, pricing: { input: 0.3, output: 2.5 } },
  ollama: { name: "ollama", displayName: "Local models (Ollama)", local: true, supportsTools: true, pricing: { input: 0, output: 0 } },
  custom: { name: "custom", displayName: "Custom API", local: false, supportsTools: true },
  echo: { name: "echo", displayName: "Offline echo (testing)", local: true, supportsTools: false, pricing: { input: 0, output: 0 } },
};

export function estimateCostUsd(provider: string, inputTokens: number, outputTokens: number): number {
  const p = PROVIDER_CATALOG[provider]?.pricing;
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export interface HealthResult {
  provider: string;
  ok: boolean;
  latencyMs: number;
  model?: string;
  error?: string;
}

/** Sends a tiny prompt to check that a provider and its key work. */
export async function checkHealth(provider: ModelProvider, timeoutMs = 20_000): Promise<HealthResult> {
  const started = Date.now();
  try {
    const res = (await Promise.race([
      provider.chat({ messages: [{ role: "user", content: "Reply with: ok" }], maxTokens: 5 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ])) as ChatResponse;
    return { provider: provider.name, ok: true, latencyMs: Date.now() - started, model: res.model };
  } catch (e) {
    return { provider: provider.name, ok: false, latencyMs: Date.now() - started, error: (e as Error).message };
  }
}
