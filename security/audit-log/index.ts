import * as fs from "node:fs";
import { AuditEvent, AuditLog } from "../../common/typescript/src";

export { AuditLog } from "../../common/typescript/src";
export type { AuditEvent } from "../../common/typescript/src";

export interface AuditQuery {
  actor?: string;
  action?: string | RegExp;
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Reads an audit file (JSON lines). */
export function readAuditFile(filePath: string): AuditEvent[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as AuditEvent);
}

/** Filters audit events, newest first. */
export function queryAudit(events: AuditEvent[], q: AuditQuery = {}): AuditEvent[] {
  return events
    .filter((e) => !q.actor || e.actor === q.actor)
    .filter((e) => !q.action || (typeof q.action === "string" ? e.action === q.action : q.action.test(e.action)))
    .filter((e) => !q.from || new Date(e.ts) >= q.from)
    .filter((e) => !q.to || new Date(e.ts) <= q.to)
    .reverse()
    .slice(0, q.limit ?? 1000);
}

/** One-line integrity report for dashboards and CI. */
export function integrityReport(filePath: string): { ok: boolean; events: number; brokenAt: number } {
  const events = readAuditFile(filePath).length;
  const brokenAt = events ? AuditLog.verifyFile(filePath) : -1;
  return { ok: brokenAt === -1, events, brokenAt };
}
