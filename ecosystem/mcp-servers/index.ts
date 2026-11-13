import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as fs from "node:fs";
import { ToolDefinition } from "../../common/typescript/src";

/** One entry of mcp-servers.json (same shape as other MCP hosts use). */
export interface McpServerConfig {
  command: string;
  args?: string[];
  /** Only these variables are passed to the server (plus PATH). Put secrets here via your SecretStore. */
  env?: Record<string, string>;
  /** Tools from this server need user approval (default true). */
  requireApproval?: boolean;
  /** Only expose these tool names. */
  allowedTools?: string[];
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/**
 * Minimal Model Context Protocol client over stdio (JSON-RPC 2.0, newline-delimited).
 * Supports initialize, tools/list and tools/call, and turns MCP tools into ToolRegistry tools.
 */
export class McpClient {
  private proc?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private buffer = "";

  constructor(readonly name: string, private readonly config: McpServerConfig, private readonly timeoutMs = 30_000) {}

  async start(): Promise<void> {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...this.config.env };
    this.proc = spawn(this.config.command, this.config.args ?? [], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.proc.on("exit", () => this.failAll(new Error(`MCP server ${this.name} exited`)));
    this.proc.on("error", (e) => this.failAll(e));
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ai-native-dev-platform", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpTool[]> {
    const res = await this.request("tools/list", {});
    const tools: McpTool[] = res.tools ?? [];
    return this.config.allowedTools ? tools.filter((t) => this.config.allowedTools!.includes(t.name)) : tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.request("tools/call", { name, arguments: args });
    const text = (res.content ?? []).map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
    if (res.isError) throw new Error(text || "MCP tool error");
    return text;
  }

  /** MCP tools as platform tools, named "<server>__<tool>". */
  async toToolDefinitions(): Promise<ToolDefinition[]> {
    const prefix = this.name.replace(/[^A-Za-z0-9_-]/g, "_");
    return (await this.listTools()).map((t) => ({
      requiresApproval: this.config.requireApproval ?? true,
      spec: {
        name: `${prefix}__${t.name}`.slice(0, 64),
        description: `[MCP ${this.name}] ${t.description ?? t.name}`,
        parameters: t.inputSchema ?? { type: "object", properties: {} },
      },
      handler: (args) => this.callTool(t.name, args),
    }));
  }

  stop(): void {
    this.proc?.kill();
    this.failAll(new Error("MCP client stopped"));
  }

  private request(method: string, params: unknown): Promise<any> {
    if (!this.proc) return Promise.reject(new Error("MCP client not started"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private notify(method: string, params: unknown): void {
    this.proc?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; }
      const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
      if (!p) continue;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "MCP error"));
      else p.resolve(msg.result ?? {});
    }
  }

  private failAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}

/** Reads mcp-servers.json: { "servers": { "<name>": McpServerConfig } }. */
export function loadMcpConfig(file: string): Record<string, McpServerConfig> {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")).servers ?? {};
}

/** Starts every configured server and returns their tools. Servers that fail are skipped and reported. */
export async function startMcpServers(file: string): Promise<{ clients: McpClient[]; tools: ToolDefinition[]; errors: string[] }> {
  const clients: McpClient[] = [];
  const tools: ToolDefinition[] = [];
  const errors: string[] = [];
  for (const [name, cfg] of Object.entries(loadMcpConfig(file))) {
    const c = new McpClient(name, cfg);
    try {
      await c.start();
      tools.push(...(await c.toToolDefinitions()));
      clients.push(c);
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
      c.stop();
    }
  }
  return { clients, tools, errors };
}
