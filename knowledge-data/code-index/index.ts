import * as fs from "node:fs";
import * as path from "node:path";
import { ToolDefinition } from "../../common/typescript/src";
import { Embedder, SearchHit, VectorStore } from "../vector-store";

export interface CodeChunkMeta {
  file: string;
  startLine: number;
  endLine: number;
  language: string;
  symbols: string[];
}

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "procedure" | "interface" | "method";
  file: string;
  line: number;
}

const LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".mjs": "javascript", ".java": "java", ".py": "python",
  ".rpgle": "rpgle", ".sqlrpgle": "rpgle", ".rpg": "rpgle", ".clle": "cl", ".clp": "cl", ".sql": "sql", ".cs": "csharp",
  ".go": "go", ".kt": "kotlin", ".md": "markdown", ".json": "json", ".xml": "xml", ".yml": "yaml", ".yaml": "yaml",
};

const SYMBOL_PATTERNS: Array<{ kind: CodeSymbol["kind"]; re: RegExp }> = [
  { kind: "class", re: /^\s*(?:export\s+)?(?:public\s+|abstract\s+|final\s+)*class\s+([A-Za-z_]\w*)/ },
  { kind: "interface", re: /^\s*(?:export\s+)?(?:public\s+)?interface\s+([A-Za-z_]\w*)/ },
  { kind: "function", re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)/ },
  { kind: "function", re: /^\s*def\s+([A-Za-z_]\w*)\s*\(/ },
  { kind: "method", re: /^\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\],\s]+\s+([A-Za-z_]\w*)\s*\([^;]*$/ },
  { kind: "procedure", re: /^\s*dcl-proc\s+([A-Za-z_@#$][\w@#$]*)/i },
];

/** Extracts classes, functions, methods and RPG procedures with line numbers. */
export function extractSymbols(file: string, text: string): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const p of SYMBOL_PATTERNS) {
      const m = p.re.exec(line);
      if (m) { out.push({ name: m[1], kind: p.kind, file, line: i + 1 }); break; }
    }
  });
  return out;
}

/**
 * Semantic + symbol code search. Splits files into overlapping line chunks, stores them in the
 * vector store, and keeps a symbol table for "go to definition" style lookups.
 */
export class CodeIndex {
  readonly store: VectorStore<CodeChunkMeta>;
  private symbols: CodeSymbol[] = [];

  constructor(embedder?: Embedder, private readonly chunkLines = 60, private readonly overlap = 10, private readonly maxFileBytes = 500_000) {
    this.store = new VectorStore<CodeChunkMeta>(embedder);
  }

  /** Indexes files (relative paths) under root. Returns the number of chunks. */
  async indexFiles(root: string, files: string[]): Promise<number> {
    const items: Array<{ id: string; text: string; metadata: CodeChunkMeta }> = [];
    for (const rel of files) {
      const language = LANG[path.extname(rel).toLowerCase()];
      if (!language) continue;
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs) || fs.statSync(abs).size > this.maxFileBytes) continue;
      const text = fs.readFileSync(abs, "utf8");
      if (text.includes("\0")) continue;
      this.removeFile(rel);
      const syms = extractSymbols(rel, text);
      this.symbols.push(...syms);
      const lines = text.split(/\r?\n/);
      const step = Math.max(1, this.chunkLines - this.overlap);
      for (let start = 0; start < lines.length; start += step) {
        const end = Math.min(lines.length, start + this.chunkLines);
        const chunk = lines.slice(start, end).join("\n");
        if (chunk.trim()) {
          const chunkSyms = syms.filter((s) => s.line > start && s.line <= end).map((s) => s.name);
          items.push({
            id: `${rel}#${start + 1}`,
            text: `${rel}\n${chunk}`,
            metadata: { file: rel, startLine: start + 1, endLine: end, language, symbols: chunkSyms },
          });
        }
        if (end >= lines.length) break;
      }
    }
    await this.store.upsert(items);
    return items.length;
  }

  removeFile(rel: string): void {
    this.store.delete((r) => r.metadata.file === rel);
    this.symbols = this.symbols.filter((s) => s.file !== rel);
  }

  search(query: string, topK = 8, language?: string): Promise<SearchHit<CodeChunkMeta>[]> {
    return this.store.search(query, topK, language ? (m) => m.language === language : undefined);
  }

  findSymbol(name: string): CodeSymbol[] {
    const n = name.toLowerCase();
    return this.symbols.filter((s) => s.name.toLowerCase() === n || s.name.toLowerCase().includes(n));
  }

  allSymbols(): readonly CodeSymbol[] { return this.symbols; }

  tools(): ToolDefinition[] {
    return [
      {
        spec: {
          name: "search_code",
          description: "Semantic search over the indexed code base. Returns file, line range and snippet.",
          parameters: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 300 }, top_k: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"], additionalProperties: false },
        },
        handler: async ({ query, top_k }) =>
          (await this.search(String(query), Number(top_k ?? 6))).map((h) => ({
            file: h.metadata.file, lines: `${h.metadata.startLine}-${h.metadata.endLine}`, score: Number(h.score.toFixed(3)), snippet: h.text.slice(0, 1200),
          })),
      },
      {
        spec: {
          name: "find_symbol",
          description: "Find where a class, function, method or RPG procedure is defined.",
          parameters: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 120 } }, required: ["name"], additionalProperties: false },
        },
        handler: ({ name }) => this.findSymbol(String(name)).slice(0, 50),
      },
    ];
  }
}
