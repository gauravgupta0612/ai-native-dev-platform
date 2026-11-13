import { ChatRequest, ChatResponse, ModelProvider } from "../types";
import { postJson, safeParseArgs } from "./http";

export interface OpenAICompatibleOptions {
  /** Provider name used by the router, e.g. "openai", "ollama", "custom". */
  name: string;
  /** Base URL that ends before /chat/completions, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  timeoutMs?: number;
}

/**
 * Works with OpenAI and every OpenAI-compatible endpoint:
 * Ollama (http://localhost:11434/v1), LM Studio, vLLM, Azure-style gateways, in-house APIs.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.name = opts.name;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model ?? this.opts.defaultModel;
    const body: Record<string, unknown> = {
      model,
      messages: req.messages.map((m) => {
        if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
        if (m.role === "assistant" && m.toolCalls?.length) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.arguments) },
            })),
          };
        }
        return { role: m.role, content: m.content };
      }),
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    const headers: Record<string, string> = {};
    if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;

    const url = `${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const data = await postJson(this.name, url, body, headers, this.opts.timeoutMs);
    const msg = data.choices?.[0]?.message ?? {};
    return {
      content: msg.content ?? "",
      toolCalls: (msg.tool_calls ?? []).map((c: any) => ({
        id: c.id,
        name: c.function?.name,
        arguments: safeParseArgs(c.function?.arguments),
      })),
      model: data.model ?? model,
      provider: this.name,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}
