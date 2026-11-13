import * as fs from "node:fs";
import * as path from "node:path";
import { AgentResult, Metrics } from "../../common/typescript/src";
import { estimateCostUsd } from "../../model-providers/_shared";

export interface RunTelemetry {
  ts: string;
  agent: string;
  task?: string;
  stoppedReason: string;
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  provider?: string;
  costUsd: number;
}

/**
 * Local telemetry: one JSON line per agent run (no prompts, no code, no secrets).
 * Feeds enterprise/advanced-analytics. Disable with enabled=false.
 */
export class Telemetry {
  constructor(private readonly file?: string, private readonly enabled = true) {
    if (file) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  recordRun(agent: string, result: AgentResult, durationMs: number, provider?: string, task?: string): RunTelemetry {
    const t: RunTelemetry = {
      ts: new Date().toISOString(), agent, task, stoppedReason: result.stoppedReason, steps: result.steps, toolCalls: result.toolCalls,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, durationMs, provider,
      costUsd: provider ? Number(estimateCostUsd(provider, result.usage.inputTokens, result.usage.outputTokens).toFixed(6)) : 0,
    };
    if (this.enabled && this.file) fs.appendFileSync(this.file, JSON.stringify(t) + "\n");
    return t;
  }

  /** Provider health table from router metrics (for a status bar or /health endpoint). */
  static providerSummary(metrics: Metrics) {
    return Object.entries(metrics.snapshot()).map(([provider, s]) => ({
      provider,
      calls: s.calls,
      errorRate: s.calls ? Number((s.failures / s.calls).toFixed(3)) : 0,
      avgLatencyMs: s.avgLatencyMs,
      tokens: s.inputTokens + s.outputTokens,
      costUsd: Number(estimateCostUsd(provider, s.inputTokens, s.outputTokens).toFixed(4)),
    }));
  }
}
