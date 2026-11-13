import * as fs from "node:fs";
import * as path from "node:path";
import { ToolDefinition } from "../../common/typescript/src";
import { CodeSymbol } from "../code-index";

export interface GraphNode {
  id: string;
  type: "file" | "symbol" | "module" | "ticket" | "doc" | string;
  label: string;
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "defines" | "imports" | "calls" | "references" | "relates-to" | string;
}

/** Relationships between files, symbols, modules, tickets and docs. Answers "what depends on X?" quickly. */
export class KnowledgeGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly out = new Map<string, GraphEdge[]>();
  private readonly inc = new Map<string, GraphEdge[]>();

  addNode(n: GraphNode): void { this.nodes.set(n.id, { ...this.nodes.get(n.id), ...n }); }

  addEdge(e: GraphEdge): void {
    if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) throw new Error(`Unknown node in edge ${e.from} -> ${e.to}`);
    const list = this.out.get(e.from) ?? [];
    if (list.some((x) => x.to === e.to && x.type === e.type)) return;
    list.push(e);
    this.out.set(e.from, list);
    this.inc.set(e.to, [...(this.inc.get(e.to) ?? []), e]);
  }

  clear(): void {
    this.nodes.clear();
    this.out.clear();
    this.inc.clear();
  }

  node(id: string): GraphNode | undefined { return this.nodes.get(id); }
  get nodeCount(): number { return this.nodes.size; }

  neighbors(id: string, direction: "out" | "in" | "both" = "both", type?: string): GraphNode[] {
    const edges = [
      ...(direction !== "in" ? (this.out.get(id) ?? []).map((e) => e.to) : []),
      ...(direction !== "out" ? (this.inc.get(id) ?? []).map((e) => e.from) : []),
    ];
    const ids = [...new Set(edges)];
    return ids.map((i) => this.nodes.get(i)!).filter((n) => !type || n.type === type);
  }

  /** Shortest path (BFS) between two nodes, following edges in both directions. */
  path(from: string, to: string, maxDepth = 8): string[] | undefined {
    const prev = new Map<string, string | null>([[from, null]]);
    let frontier = [from];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of this.neighbors(id)) {
          if (prev.has(n.id)) continue;
          prev.set(n.id, id);
          if (n.id === to) {
            const p = [to];
            let cur = id;
            while (cur) { p.unshift(cur); cur = prev.get(cur)!; }
            return p;
          }
          next.push(n.id);
        }
      }
      frontier = next;
    }
    return undefined;
  }

  /** Everything that (transitively) points to a node: impact analysis before changing it. */
  impactOf(id: string, maxDepth = 5): GraphNode[] {
    const seen = new Set<string>([id]);
    let frontier = [id];
    for (let d = 0; d < maxDepth; d++) {
      frontier = frontier.flatMap((f) => (this.inc.get(f) ?? []).map((e) => e.from)).filter((x) => !seen.has(x) && seen.add(x));
    }
    seen.delete(id);
    return [...seen].map((i) => this.nodes.get(i)!);
  }

  /** Builds file/symbol nodes and import edges from source files and code-index symbols. */
  buildFromCode(root: string, files: string[], symbols: readonly CodeSymbol[]): void {
    for (const f of files) this.addNode({ id: `file:${f}`, type: "file", label: f });
    for (const s of symbols) {
      const id = `symbol:${s.file}:${s.name}`;
      this.addNode({ id, type: "symbol", label: s.name, data: { kind: s.kind, line: s.line } });
      if (this.nodes.has(`file:${s.file}`)) this.addEdge({ from: `file:${s.file}`, to: id, type: "defines" });
    }
    const importRe = /(?:import\s[^'"]*from\s*|require\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]|\/copy\s+([\w\/,.-]+)|^\s*from\s+(\.+[\w.]*)\s+import/gim;
    const fileSet = new Set(files);
    for (const f of files) {
      const abs = path.join(root, f);
      if (!fs.existsSync(abs) || fs.statSync(abs).size > 500_000) continue;
      const text = fs.readFileSync(abs, "utf8");
      for (const m of text.matchAll(importRe)) {
        const spec = m[1];
        if (!spec) continue;
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
        const target = [base, `${base}.ts`, `${base}.js`, `${base}/index.ts`, `${base}.py`].find((c) => fileSet.has(c));
        if (target) this.addEdge({ from: `file:${f}`, to: `file:${target}`, type: "imports" });
      }
    }
  }

  toJSON(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return { nodes: [...this.nodes.values()], edges: [...this.out.values()].flat() };
  }

  static fromJSON(data: { nodes: GraphNode[]; edges: GraphEdge[] }): KnowledgeGraph {
    const g = new KnowledgeGraph();
    data.nodes.forEach((n) => g.addNode(n));
    data.edges.forEach((e) => g.addEdge(e));
    return g;
  }

  tools(): ToolDefinition[] {
    return [{
      spec: {
        name: "impact_analysis",
        description: "List files and symbols that depend on the given file (e.g. 'file:src/orders.ts').",
        parameters: { type: "object", properties: { node: { type: "string", minLength: 3 } }, required: ["node"], additionalProperties: false },
      },
      handler: ({ node }) => this.impactOf(String(node)).map((n) => ({ id: n.id, type: n.type })),
    }];
  }
}
