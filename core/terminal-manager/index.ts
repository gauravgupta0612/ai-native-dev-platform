import { randomUUID } from "node:crypto";
import { ToolDefinition } from "../../common/typescript/src";
import { CommandSandbox, RunResult, SandboxPolicy } from "../../security/sandbox";

export interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  history: RunResult[];
}

/**
 * Terminal sessions for the IDE. Every command runs through the CommandSandbox
 * (allow-listed programs, no shell injection, workspace-only, secrets removed from env, timeouts).
 */
export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly sandbox: CommandSandbox;

  constructor(policy: SandboxPolicy, private readonly maxHistory = 50) {
    this.sandbox = new CommandSandbox(policy);
  }

  open(name = "terminal", cwd = "."): TerminalSession {
    const s: TerminalSession = { id: randomUUID(), name, cwd, history: [] };
    this.sessions.set(s.id, s);
    return s;
  }

  close(id: string): boolean { return this.sessions.delete(id); }
  list(): TerminalSession[] { return [...this.sessions.values()]; }

  async run(sessionId: string, command: string, args: string[] = []): Promise<RunResult> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`No terminal session ${sessionId}`);
    const result = await this.sandbox.run(command, args, s.cwd);
    s.history.push(result);
    if (s.history.length > this.maxHistory) s.history.shift();
    return result;
  }

  /** Agent tool: run an allow-listed command. Always needs approval. */
  tool(): ToolDefinition {
    return {
      requiresApproval: true,
      timeoutMs: 5 * 60_000,
      spec: {
        name: "run_command",
        description: "Run an allowed command (no shell) in the workspace, e.g. {command:'npm', args:['test']}.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", minLength: 1, maxLength: 64 },
            args: { type: "array", items: { type: "string", maxLength: 500 } },
            cwd: { type: "string" },
          },
          required: ["command"],
          additionalProperties: false,
        },
      },
      handler: async ({ command, args, cwd }) => {
        const r = await this.sandbox.run(String(command), (args as string[] | undefined) ?? [], cwd ? String(cwd) : undefined);
        return { exitCode: r.exitCode, timedOut: r.timedOut, stdout: r.stdout.slice(-8000), stderr: r.stderr.slice(-4000) };
      },
    };
  }
}
