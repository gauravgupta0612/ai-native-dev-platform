import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEvent {
  ts: string;
  actor: string;
  action: string;
  details?: Record<string, unknown>;
}

/** Append-only audit trail (JSON lines). Writes to a file if a path is given, always keeps the last events in memory. */
export class AuditLog {
  private readonly recent: AuditEvent[] = [];

  constructor(private readonly filePath?: string, private readonly keepInMemory = 1000) {
    if (filePath) mkdirSync(dirname(filePath), { recursive: true });
  }

  record(actor: string, action: string, details?: Record<string, unknown>): AuditEvent {
    const event: AuditEvent = { ts: new Date().toISOString(), actor, action, details };
    this.recent.push(event);
    if (this.recent.length > this.keepInMemory) this.recent.shift();
    if (this.filePath) appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  events(): readonly AuditEvent[] { return this.recent; }
}
