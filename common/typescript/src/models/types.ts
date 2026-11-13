/** Shared, provider-neutral types used by every module. */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** Set on assistant messages that ask to run tools. */
  toolCalls?: ToolCall[];
  /** Set on tool messages: which call this result answers. */
  toolCallId?: string;
  /** Tool name (for tool messages). */
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  model: string;
  provider: string;
  usage: Usage;
}

/** Every AI model adapter implements this one interface. */
export interface ModelProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export class ProviderError extends Error {
  constructor(public readonly provider: string, message: string, public readonly status?: number) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}
