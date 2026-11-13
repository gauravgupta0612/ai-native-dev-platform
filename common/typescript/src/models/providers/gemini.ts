import { ChatRequest, ChatResponse, ModelProvider } from "../types";
import { postJson } from "./http";

export interface GeminiOptions {
  apiKey: string;
  defaultModel: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Google Gemini generateContent adapter (text chat).
 * Tool messages are passed as plain text; use OpenAI/Anthropic for native tool calling.
 */
export class GeminiProvider implements ModelProvider {
  readonly name = "gemini";
  constructor(private readonly opts: GeminiOptions) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model ?? this.opts.defaultModel;
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.role === "tool" ? `Tool result (${m.name ?? m.toolCallId}): ${m.content}` : m.content }],
      }));
    const body: Record<string, unknown> = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const gen: Record<string, unknown> = {};
    if (req.temperature !== undefined) gen.temperature = req.temperature;
    if (req.maxTokens !== undefined) gen.maxOutputTokens = req.maxTokens;
    if (Object.keys(gen).length) body.generationConfig = gen;

    const base = (this.opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
    const data = await postJson(this.name, url, body, { "x-goog-api-key": this.opts.apiKey }, this.opts.timeoutMs);
    const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
    return {
      content: parts.map((p) => p.text ?? "").join(""),
      toolCalls: [],
      model,
      provider: this.name,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
