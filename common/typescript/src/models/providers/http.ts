import { ProviderError } from "../types";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

/** Only HTTPS is allowed, except for local endpoints (Ollama, LM Studio, tests). Keys never travel in clear text. */
export function assertSecureUrl(provider: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderError(provider, `Invalid URL: ${url}`, 0);
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname)) return;
  throw new ProviderError(provider, `Insecure URL refused (use https): ${parsed.origin}`, 0);
}

/** Small JSON POST helper with timeout, shared by all HTTP providers. */
export async function postJson(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 60_000,
): Promise<any> {
  assertSecureUrl(provider, url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error", // never forward API keys to a redirected host
    });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}: ${text.slice(0, 500)}`, res.status);
    return text ? JSON.parse(text) : {};
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const msg = (err as Error).name === "AbortError" ? `timeout after ${timeoutMs} ms` : (err as Error).message;
    throw new ProviderError(provider, msg);
  } finally {
    clearTimeout(timer);
  }
}

export function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : { _raw: raw };
    } catch {
      return { _raw: raw };
    }
  }
  return {};
}
