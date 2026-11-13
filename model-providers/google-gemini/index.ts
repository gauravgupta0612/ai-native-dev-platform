import { GeminiProvider } from "../../common/typescript/src";
import { SecretStore } from "../../security/secure-storage";

/** Google Gemini (text chat). Key from the SecretStore entry GEMINI_API_KEY. */
export function createGeminiProvider(secrets: SecretStore, model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash") {
  const apiKey = secrets.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GeminiProvider({ apiKey, defaultModel: model });
}
