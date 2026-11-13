import { ProviderError } from "../types";

/** Small JSON POST helper with timeout, shared by all HTTP providers. */
export async function postJson(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 60_000,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}: ${text.slice(0, 500)}`, res.status);
    return text ? JSON.parse(text) : {};
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(provider, (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

export function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return { _raw: raw };
    }
  }
  return {};
}
