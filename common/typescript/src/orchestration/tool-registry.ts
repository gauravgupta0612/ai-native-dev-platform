import { ToolCall, ToolSpec } from "../models/types";

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export interface ToolDefinition {
  spec: ToolSpec;
  handler: ToolHandler;
  /** If true, the approver callback must say yes before it runs (e.g. writes, shell). */
  requiresApproval?: boolean;
}

/** Return true to allow a tool call. Plug in a UI prompt, a policy, or auto-approve in tests. */
export type Approver = (call: ToolCall) => Promise<boolean> | boolean;

export interface ToolResult {
  callId: string;
  name: string;
  ok: boolean;
  output: string;
}

/** Holds the tools agents may use and executes them safely (errors become results, not crashes). */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): this {
    if (this.tools.has(def.spec.name)) throw new Error(`Tool already registered: ${def.spec.name}`);
    this.tools.set(def.spec.name, def);
    return this;
  }

  has(name: string): boolean { return this.tools.has(name); }
  specs(): ToolSpec[] { return [...this.tools.values()].map((t) => t.spec); }

  async execute(call: ToolCall, approver?: Approver): Promise<ToolResult> {
    const def = this.tools.get(call.name);
    if (!def) return { callId: call.id, name: call.name, ok: false, output: `Unknown tool: ${call.name}` };
    if (def.requiresApproval && !(approver && (await approver(call)))) {
      return { callId: call.id, name: call.name, ok: false, output: "Denied: tool call was not approved" };
    }
    try {
      const value = await def.handler(call.arguments ?? {});
      const output = typeof value === "string" ? value : JSON.stringify(value);
      return { callId: call.id, name: call.name, ok: true, output };
    } catch (err) {
      return { callId: call.id, name: call.name, ok: false, output: `Error: ${(err as Error).message}` };
    }
  }
}
