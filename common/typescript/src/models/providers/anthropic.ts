import { ChatRequest, ChatResponse, ModelProvider } from "../types";
import { postJson } from "./http";

export interface AnthropicOptions {
  apiKey: string;
  defaultModel: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/** Anthropic (Claude) Messages API adapter, with tool use. */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  constructor(private readonly opts: AnthropicOptions) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model ?? this.opts.defaultModel;
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages: any[] = [];
    for (const m of req.messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        messages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
        });
      } else if (m.role === "assistant" && m.toolCalls?.length) {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const c of m.toolCalls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.arguments });
        messages.push({ role: "assistant", content: blocks });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }
    const body: Record<string, unknown> = { model, max_tokens: req.maxTokens ?? 4096, messages };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }
    const url = `${(this.opts.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`;
    const data = await postJson(
      this.name,
      url,
      body,
      { "x-api-key": this.opts.apiKey, "anthropic-version": "2023-06-01" },
      this.opts.timeoutMs,
    );
    const blocks: any[] = data.content ?? [];
    return {
      content: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
      toolCalls: blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, arguments: b.input ?? {} })),
      model: data.model ?? model,
      provider: this.name,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    };
  }
}
