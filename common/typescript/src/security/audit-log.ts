import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactSecrets } from "./guardrails";

export interface AuditEvent {
  ts: string;
  actor: string;
  action: string;
  details?: Record<string, unknown>;
  /** Hash of the previous event ("" for the first one). */
  prevHash: string;
  /** sha256(prevHash + ts + actor + action + details). Changing any past line breaks the chain. */
  hash: string;
}

const GENESIS = "";

function computeHash(e: Omit<AuditEvent, "hash">): string {
  return createHash("sha256")
    .update(e.prevHash + "|" + e.ts + "|" + e.actor + "|" + e.action + "|" + JSON.stringify(e.details ?? {}))
    .digest("hex");
}

/**
 * Tamper-evident, append-only audit trail (JSON lines, hash-chained).
 * Secrets in details are masked before writing. Use AuditLog.verifyFile() to check integrity.
 */
export class AuditLog {
  private readonly recent: AuditEvent[] = [];
  private lastHash = GENESIS;

  constructor(private readonly filePath?: string, private readonly keepInMemory = 1000) {
    if (filePath) {
      mkdirSync(dirname(filePath), { recursive: true });
      if (existsSync(filePath)) {
        const lines = readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
        if (lines.length) this.lastHash = JSON.parse(lines[lines.length - 1]).hash ?? GENESIS;
      }
    }
  }

  record(actor: string, action: string, details?: Record<string, unknown>): AuditEvent {
    const safeDetails = details ? JSON.parse(redactSecrets(JSON.stringify(details), false)) : undefined;
    const partial = { ts: new Date().toISOString(), actor, action, details: safeDetails, prevHash: this.lastHash };
    const event: AuditEvent = { ...partial, hash: computeHash(partial) };
    this.lastHash = event.hash;
    this.recent.push(event);
    if (this.recent.length > this.keepInMemory) this.recent.shift();
    if (this.filePath) appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  events(): readonly AuditEvent[] { return this.recent; }

  /** Checks a list of consecutive events. Returns the index of the first broken event, or -1 if intact. */
  static verify(events: readonly AuditEvent[]): number {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (i > 0 && e.prevHash !== events[i - 1].hash) return i;
      const { hash, ...rest } = e;
      if (computeHash(rest) !== hash) return i;
    }
    return -1;
  }

  /** Verifies a whole audit file. Returns -1 if intact, otherwise the 0-based line number that was altered. */
  static verifyFile(filePath: string): number {
    const lines = readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    const events = lines.map((l) => JSON.parse(l) as AuditEvent);
    if (events.length && events[0].prevHash !== GENESIS) return 0;
    return AuditLog.verify(events);
  }
}
