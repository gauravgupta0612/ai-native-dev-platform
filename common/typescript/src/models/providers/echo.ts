import { ChatRequest, ChatResponse, ModelProvider } from "../types";

/** Offline provider for tests, demos and CI — no network, no API key. */
export class EchoProvider implements ModelProvider {
  readonly name = "echo";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const content = `Echo: ${lastUser?.content ?? ""}`;
    const input = req.messages.reduce((n, m) => n + m.content.length, 0);
    return {
      content,
      toolCalls: [],
      model: req.model ?? "echo-1",
      provider: this.name,
      usage: { inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(content.length / 4) },
    };
  }
}
