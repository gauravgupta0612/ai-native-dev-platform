import * as fs from "node:fs";
import type { RunTelemetry } from "../../ai-orchestration/observability";

export interface UsageReport {
  from?: string;
  to?: string;
  runs: number;
  totalTokens: number;
  totalCostUsd: number;
  completionRate: number;
  byDay: Record<string, { runs: number; tokens: number; costUsd: number }>;
  byAgent: Record<string, { runs: number; tokens: number; avgSteps: number }>;
  byProvider: Record<string, { runs: number; tokens: number; costUsd: number }>;
  stopReasons: Record<string, number>;
}

export function readTelemetry(file: string): RunTelemetry[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

/** Aggregates telemetry for dashboards: usage per day/agent/provider, cost, completion rate. */
export function buildUsageReport(runs: RunTelemetry[], from?: Date, to?: Date): UsageReport {
  const sel = runs.filter((r) => (!from || new Date(r.ts) >= from) && (!to || new Date(r.ts) <= to));
  const rep: UsageReport = {
    from: from?.toISOString(), to: to?.toISOString(), runs: sel.length, totalTokens: 0, totalCostUsd: 0, completionRate: 0,
    byDay: {}, byAgent: {}, byProvider: {}, stopReasons: {},
  };
  const steps: Record<string, number> = {};
  for (const r of sel) {
    const tokens = r.inputTokens + r.outputTokens;
    rep.totalTokens += tokens;
    rep.totalCostUsd += r.costUsd;
    const day = r.ts.slice(0, 10);
    const d = (rep.byDay[day] ??= { runs: 0, tokens: 0, costUsd: 0 });
    d.runs++; d.tokens += tokens; d.costUsd += r.costUsd;
    const a = (rep.byAgent[r.agent] ??= { runs: 0, tokens: 0, avgSteps: 0 });
    a.runs++; a.tokens += tokens; steps[r.agent] = (steps[r.agent] ?? 0) + r.steps;
    const p = (rep.byProvider[r.provider ?? "unknown"] ??= { runs: 0, tokens: 0, costUsd: 0 });
    p.runs++; p.tokens += tokens; p.costUsd += r.costUsd;
    rep.stopReasons[r.stoppedReason] = (rep.stopReasons[r.stoppedReason] ?? 0) + 1;
  }
  for (const [k, a] of Object.entries(rep.byAgent)) a.avgSteps = Number((steps[k] / a.runs).toFixed(2));
  rep.completionRate = sel.length ? Number(((rep.stopReasons.completed ?? 0) / sel.length).toFixed(3)) : 0;
  rep.totalCostUsd = Number(rep.totalCostUsd.toFixed(4));
  return rep;
}

/** CSV export (one row per day) for Excel / BI tools. */
export function toCsv(rep: UsageReport): string {
  const rows = [["day", "runs", "tokens", "cost_usd"]];
  for (const [day, d] of Object.entries(rep.byDay).sort()) rows.push([day, String(d.runs), String(d.tokens), d.costUsd.toFixed(4)]);
  return rows.map((r) => r.join(",")).join("\n") + "\n";
}
