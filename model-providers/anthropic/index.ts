import { AnthropicProvider } from "../../common/typescript/src";
import { SecretStore } from "../../security/secure-storage";

/** Anthropic (Claude). Key from the SecretStore entry ANTHROPIC_API_KEY. */
export function createAnthropicProvider(secrets: SecretStore, model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5") {
  const apiKey = secrets.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new AnthropicProvider({ apiKey, defaultModel: model });
}
