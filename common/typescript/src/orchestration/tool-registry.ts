import { ToolCall, ToolSpec } from "../models/types";
import { validateArgs } from "./schema-validator";

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export interface ToolDefinition {
  spec: ToolSpec;
  handler: ToolHandler;
  /** If true, the approver callback must say yes before it runs (e.g. writes, shell). */
  requiresApproval?: boolean;
  /** Per-tool timeout. Defaults to the registry timeout. */
  timeoutMs?: number;
}

/** Return true to allow a tool call. Plug in a UI prompt, a policy, or auto-approve in tests. */
export type Approver = (call: ToolCall) => Promise<boolean> | boolean;

export interface ToolResult {
  callId: string;
  name: string;
  ok: boolean;
  output: string;
}

export interface ToolRegistryOptions {
  /** Default time limit per tool call. Default 30 s. */
  timeoutMs?: number;
  /** Longer outputs are cut (protects the context window). Default 20 000 characters. */
  maxOutputChars?: number;
}

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * Holds the tools agents may use and executes them safely:
 * argument validation against the JSON schema, approval for risky tools, timeouts, output size cap,
 * and errors returned as results instead of crashing the agent.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly timeoutMs: number;
  private readonly maxOutputChars: number;

  constructor(opts: ToolRegistryOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxOutputChars = opts.maxOutputChars ?? 20_000;
  }

  register(def: ToolDefinition): this {
    if (!NAME.test(def.spec.name)) throw new Error(`Invalid tool name: ${def.spec.name}`);
    if (this.tools.has(def.spec.name)) throw new Error(`Tool already registered: ${def.spec.name}`);
    this.tools.set(def.spec.name, def);
    return this;
  }

  registerAll(defs: ToolDefinition[]): this {
    defs.forEach((d) => this.register(d));
    return this;
  }

  has(name: string): boolean { return this.tools.has(name); }
  specs(): ToolSpec[] { return [...this.tools.values()].map((t) => t.spec); }

  async execute(call: ToolCall, approver?: Approver): Promise<ToolResult> {
    const fail = (output: string): ToolResult => ({ callId: call.id, name: call.name, ok: false, output });
    const def = this.tools.get(call.name);
    if (!def) return fail(`Unknown tool: ${call.name}`);

    const problems = validateArgs(def.spec.parameters, call.arguments ?? {});
    if (problems.length) return fail(`Invalid arguments: ${problems.join("; ")}`);

    if (def.requiresApproval && !(approver && (await approver(call)))) return fail("Denied: tool call was not approved");

    const timeout = def.timeoutMs ?? this.timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => def.handler(call.arguments ?? {})),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${timeout} ms`)), timeout); }),
      ]);
      let output = typeof value === "string" ? value : JSON.stringify(value);
      if (output === undefined) output = "";
      if (output.length > this.maxOutputChars) {
        output = output.slice(0, this.maxOutputChars) + `\n…[truncated ${output.length - this.maxOutputChars} characters]`;
      }
      return { callId: call.id, name: call.name, ok: true, output };
    } catch (err) {
      return fail(`Error: ${(err as Error).message}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
