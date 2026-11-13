import { ChatRequest, ChatResponse, ModelProvider, OpenAICompatibleProvider } from "../../common/typescript/src";
import { postJson } from "../../common/typescript/src/models/providers/http";
import { SecretStore } from "../../security/secure-storage";

/** Any OpenAI-compatible endpoint (Azure OpenAI gateway, vLLM, LM Studio, company proxy). HTTPS required. */
export function createCustomOpenAICompatible(name: string, baseUrl: string, model: string, secrets?: SecretStore, keyName = "CUSTOM_API_KEY") {
  return new OpenAICompatibleProvider({ name, baseUrl, defaultModel: model, apiKey: secrets?.get(keyName) });
}

export interface CustomMapping {
  /** Builds your API's body from the request. */
  toBody(req: ChatRequest, model: string): unknown;
  /** Reads the answer text (and optional token counts) from your API's response. */
  fromBody(data: any): { content: string; inputTokens?: number; outputTokens?: number };
}

/** For in-house APIs with their own JSON format: give two small mapping functions. */
export class CustomHttpProvider implements ModelProvider {
  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly model: string,
    private readonly mapping: CustomMapping,
    private readonly headers: () => Record<string, string> = () => ({}),
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model ?? this.model;
    const data = await postJson(this.name, this.url, this.mapping.toBody(req, model), this.headers());
    const out = this.mapping.fromBody(data);
    return { content: out.content, toolCalls: [], model, provider: this.name, usage: { inputTokens: out.inputTokens ?? 0, outputTokens: out.outputTokens ?? 0 } };
  }
}
