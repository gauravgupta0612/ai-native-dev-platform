import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_DENIED } from "../../common/typescript/src";

export interface WorkspaceFile {
  /** Path relative to its root, with "/" separators. */
  path: string;
  root: string;
  size: number;
  modified: number;
}

export type WorkspaceEvent = { type: "changed" | "deleted"; root: string; path: string };

const DEFAULT_IGNORE = [...DEFAULT_DENIED, /^dist$/, /^build$/, /^target$/, /^\.venv$/, /^__pycache__$/, /^\.aiplatform$/];

/**
 * Multi-root workspace: indexes files, keeps "open files" for AI context, and emits change events.
 * Secret files and build folders are excluded from the index.
 */
export class WorkspaceEngine extends EventEmitter {
  private readonly roots = new Set<string>();
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly openFiles = new Map<string, string>(); // abs path -> content

  constructor(private readonly ignore: RegExp[] = DEFAULT_IGNORE, private readonly maxFiles = 50_000) {
    super();
  }

  addRoot(dir: string): void {
    const abs = fs.realpathSync(path.resolve(dir));
    this.roots.add(abs);
  }

  removeRoot(dir: string): void {
    const abs = path.resolve(dir);
    this.roots.delete(abs);
    this.watchers.get(abs)?.close();
    this.watchers.delete(abs);
  }

  listRoots(): string[] { return [...this.roots]; }

  /** Walks every root (skipping ignored and symlinked entries). */
  index(): WorkspaceFile[] {
    const out: WorkspaceFile[] = [];
    for (const root of this.roots) {
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (out.length >= this.maxFiles) return;
          if (e.isSymbolicLink() || this.ignore.some((p) => p.test(e.name))) continue;
          const abs = path.join(dir, e.name);
          if (e.isDirectory()) walk(abs);
          else {
            const st = fs.statSync(abs);
            out.push({ path: path.relative(root, abs).split(path.sep).join("/"), root, size: st.size, modified: st.mtimeMs });
          }
        }
      };
      walk(root);
    }
    return out;
  }

  /** Start emitting "change" events (debounced per file). Recursive watch works on Windows/macOS and Node 20+ Linux. */
  watch(): void {
    for (const root of this.roots) {
      if (this.watchers.has(root)) continue;
      const timers = new Map<string, NodeJS.Timeout>();
      const w = fs.watch(root, { recursive: true }, (_evt, file) => {
        if (!file) return;
        const rel = file.toString().split(path.sep).join("/");
        if (rel.split("/").some((part) => this.ignore.some((p) => p.test(part)))) return;
        clearTimeout(timers.get(rel));
        timers.set(rel, setTimeout(() => {
          const type = fs.existsSync(path.join(root, rel)) ? "changed" : "deleted";
          this.emit("change", { type, root, path: rel } satisfies WorkspaceEvent);
        }, 100));
      });
      this.watchers.set(root, w);
    }
  }

  dispose(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  /** Resolve a path inside one of the roots (throws if outside). */
  resolve(relOrAbs: string): string {
    for (const root of this.roots) {
      const abs = path.resolve(root, relOrAbs);
      if ((abs === root || abs.startsWith(root + path.sep)) && fs.existsSync(abs)) return abs;
    }
    throw new Error(`Not in workspace: ${relOrAbs}`);
  }

  openFile(rel: string): string {
    const abs = this.resolve(rel);
    const text = fs.readFileSync(abs, "utf8");
    this.openFiles.set(abs, text);
    return text;
  }

  closeFile(rel: string): void { this.openFiles.delete(this.resolve(rel)); }

  /** Open files as context snippets for the AI (path + content). */
  openFileSnippets(maxCharsEach = 12_000): Array<{ source: string; text: string }> {
    return [...this.openFiles.entries()].map(([abs, text]) => ({ source: abs, text: text.slice(0, maxCharsEach) }));
  }
}
