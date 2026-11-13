import { OpenAICompatibleProvider } from "../../common/typescript/src";
import { SecretStore } from "../../security/secure-storage";

/** OpenAI (ChatGPT). Key from the SecretStore entry OPENAI_API_KEY. */
export function createOpenAIProvider(secrets: SecretStore, model = process.env.OPENAI_MODEL ?? "gpt-4o-mini", baseUrl = "https://api.openai.com/v1") {
  const apiKey = secrets.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAICompatibleProvider({ name: "openai", baseUrl, apiKey, defaultModel: model });
}
