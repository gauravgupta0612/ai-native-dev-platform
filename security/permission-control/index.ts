import { Approver, ToolCall } from "../../common/typescript/src";

/** What a grant allows. "tool:write_file", "command:git", "network:api.github.com", "secret:JIRA_TOKEN"... */
export type Permission = string;

export interface Grant {
  permission: Permission;
  /** Who it is for: an agent name, an extension id, or "*" for everyone. */
  subject: string;
  /** Optional limit, e.g. a folder prefix for file writes. */
  scope?: string;
  /** Epoch ms; omitted = no expiry. */
  expiresAt?: number;
  /** Remember "allow once" decisions: removed after first use. */
  once?: boolean;
}

/** Asks a human (UI dialog, CLI prompt). Return "allow-once", "allow-always" or "deny". */
export type PromptUser = (subject: string, permission: Permission, detail: string) => Promise<"allow-once" | "allow-always" | "deny">;

/**
 * Central permission store. Everything risky (writes, commands, network, secrets) asks here first.
 * Default is deny: no grant + no prompt = not allowed.
 */
export class PermissionManager {
  private grants: Grant[] = [];

  constructor(private readonly prompt?: PromptUser, private readonly now: () => number = Date.now) {}

  grant(g: Grant): void {
    this.grants.push(g);
  }

  revoke(subject: string, permission?: Permission): number {
    const before = this.grants.length;
    this.grants = this.grants.filter((g) => !(g.subject === subject && (!permission || g.permission === permission)));
    return before - this.grants.length;
  }

  list(subject?: string): Grant[] {
    this.dropExpired();
    return this.grants.filter((g) => !subject || g.subject === subject || g.subject === "*");
  }

  /** Checks without asking. */
  has(subject: string, permission: Permission, target?: string): boolean {
    return this.find(subject, permission, target) !== undefined;
  }

  /** Checks, and asks the user when no grant exists. */
  async request(subject: string, permission: Permission, target = "", detail = ""): Promise<boolean> {
    const g = this.find(subject, permission, target);
    if (g) {
      if (g.once) this.grants = this.grants.filter((x) => x !== g);
      return true;
    }
    if (!this.prompt) return false;
    const answer = await this.prompt(subject, permission, detail || target);
    if (answer === "allow-always") this.grant({ subject, permission, scope: target || undefined });
    return answer !== "deny";
  }

  /** Approver for ToolRegistry/AgentRuntime: maps each tool call to "tool:<name>" scoped by its path argument. */
  toolApprover(subject: string): Approver {
    return (call: ToolCall) => {
      const target = typeof call.arguments.path === "string" ? call.arguments.path : "";
      return this.request(subject, `tool:${call.name}`, target, JSON.stringify(call.arguments).slice(0, 300));
    };
  }

  private find(subject: string, permission: Permission, target?: string): Grant | undefined {
    this.dropExpired();
    return this.grants.find(
      (g) =>
        (g.subject === subject || g.subject === "*") &&
        (g.permission === permission || (g.permission.endsWith(":*") && permission.startsWith(g.permission.slice(0, -1)))) &&
        (!g.scope || (target !== undefined && normalize(target).startsWith(normalize(g.scope)))),
    );
  }

  private dropExpired(): void {
    const t = this.now();
    this.grants = this.grants.filter((g) => g.expiresAt === undefined || g.expiresAt > t);
  }
}

const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
