import { Usage } from "../models/types";

export interface ProviderStats {
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  totalLatencyMs: number;
}

/** In-memory usage counters per provider (tokens, calls, latency). */
export class Metrics {
  private readonly stats = new Map<string, ProviderStats>();

  record(provider: string, usage: Usage, latencyMs: number, ok: boolean): void {
    const s = this.stats.get(provider) ?? { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, totalLatencyMs: 0 };
    s.calls += 1;
    if (!ok) s.failures += 1;
    s.inputTokens += usage.inputTokens;
    s.outputTokens += usage.outputTokens;
    s.totalLatencyMs += latencyMs;
    this.stats.set(provider, s);
  }

  snapshot(): Record<string, ProviderStats & { avgLatencyMs: number }> {
    const out: Record<string, ProviderStats & { avgLatencyMs: number }> = {};
    for (const [k, s] of this.stats) out[k] = { ...s, avgLatencyMs: s.calls ? Math.round(s.totalLatencyMs / s.calls) : 0 };
    return out;
  }
}
