import { ToolDefinition, ToolRegistry, createWorkspaceTools } from "../../common/typescript/src";
import { GitService } from "../../core/git-integration";
import { TerminalManager } from "../../core/terminal-manager";
import { CodeIndex } from "../../knowledge-data/code-index";
import { KnowledgeGraph } from "../../knowledge-data/knowledge-graph";

export interface ToolSetOptions {
  workspaceRoot: string;
  allowWrite?: boolean;
  git?: GitService;
  terminal?: TerminalManager;
  codeIndex?: CodeIndex;
  graph?: KnowledgeGraph;
  /** Extra tools from extensions, MCP servers or integrations. */
  extra?: ToolDefinition[];
  timeoutMs?: number;
}

/** Tool presets for agent roles: what each kind of agent is allowed to use. */
export const ROLE_TOOLS: Record<string, string[] | "all"> = {
  reader: ["read_file", "list_files", "search_text", "search_code", "find_symbol", "git_status", "git_diff", "git_log", "impact_analysis"],
  reviewer: ["read_file", "list_files", "search_text", "search_code", "find_symbol", "git_diff", "git_log", "impact_analysis"],
  coder: "all",
};

/** Collects every platform service into one ToolRegistry. Risky tools (write_file, run_command) need approval. */
export function buildToolRegistry(opts: ToolSetOptions): ToolRegistry {
  const reg = new ToolRegistry({ timeoutMs: opts.timeoutMs ?? 30_000 });
  reg.registerAll(createWorkspaceTools(opts.workspaceRoot, { allowWrite: opts.allowWrite }));
  if (opts.codeIndex) reg.registerAll(opts.codeIndex.tools());
  if (opts.graph) reg.registerAll(opts.graph.tools());
  if (opts.git) reg.registerAll(opts.git.tools());
  if (opts.terminal) reg.register(opts.terminal.tool());
  for (const t of opts.extra ?? []) if (!reg.has(t.spec.name)) reg.register(t);
  return reg;
}

export function toolsForRole(role: keyof typeof ROLE_TOOLS | string): string[] | undefined {
  const r = ROLE_TOOLS[role];
  return r === "all" || r === undefined ? undefined : r;
}
