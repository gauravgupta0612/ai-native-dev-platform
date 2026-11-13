import { OpenAICompatibleProvider } from "../../common/typescript/src";

const DEFAULT_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

/** Local models through Ollama's OpenAI-compatible API. Nothing leaves the machine. */
export function createOllamaProvider(model = process.env.OLLAMA_MODEL ?? "llama3.1", baseUrl = DEFAULT_URL) {
  return new OpenAICompatibleProvider({ name: "ollama", baseUrl: `${baseUrl.replace(/\/+$/, "")}/v1`, defaultModel: model, timeoutMs: 180_000 });
}

/** Lists models installed in Ollama (GET /api/tags). Returns [] if Ollama is not running. */
export async function listOllamaModels(baseUrl = DEFAULT_URL): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}
