import * as fs from "node:fs";
import * as path from "node:path";
import { ToolDefinition } from "../orchestration/tool-registry";

export interface WorkspaceToolOptions {
  /** Allow the write_file tool (always requires approval). Default false. */
  allowWrite?: boolean;
  /** Largest file read_file/search_text will open. Default 1 MB. */
  maxFileBytes?: number;
  /** Max entries returned by list_files. Default 500. */
  maxEntries?: number;
  /** Extra file/folder name patterns the tools must never touch. */
  extraDenied?: RegExp[];
}

/** Files and folders that are never readable or writable by agents (secrets, VCS internals, dependencies). */
export const DEFAULT_DENIED: RegExp[] = [
  /^\.env(\..*)?$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i, /\.jks$/i, /\.keystore$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, /^\.npmrc$/i, /^\.pypirc$/i, /^\.netrc$/i, /^\.git-credentials$/i,
  /^credentials(\.json)?$/i, /^secrets?\.(json|ya?ml|txt)$/i, /^\.git$/, /^\.ssh$/, /^\.aws$/, /^node_modules$/,
];

/**
 * Safe file tools confined to one workspace folder: read_file, list_files, search_text and (optionally) write_file.
 * Blocks path traversal (../), absolute paths outside the root, symlink escapes and secret files.
 */
export function createWorkspaceTools(root: string, opts: WorkspaceToolOptions = {}): ToolDefinition[] {
  const base = fs.realpathSync(path.resolve(root));
  const maxBytes = opts.maxFileBytes ?? 1_000_000;
  const maxEntries = opts.maxEntries ?? 500;
  const denied = [...DEFAULT_DENIED, ...(opts.extraDenied ?? [])];

  const isDenied = (rel: string) => rel.split(/[\\/]/).some((part) => denied.some((p) => p.test(part)));

  const inside = (p: string) => p === base || p.startsWith(base + path.sep);

  /** Resolves a user path to an absolute path inside the workspace, or throws. */
  function resolveSafe(userPath: unknown, mustExist: boolean): string {
    if (typeof userPath !== "string" || !userPath.trim()) throw new Error("path is required");
    if (userPath.includes("\0")) throw new Error("invalid path");
    const abs = path.resolve(base, userPath);
    if (!inside(abs)) throw new Error("path is outside the workspace");
    const rel = path.relative(base, abs);
    if (rel && isDenied(rel)) throw new Error("access to this file is not allowed");
    if (fs.existsSync(abs)) {
      if (!inside(fs.realpathSync(abs))) throw new Error("path is outside the workspace (symlink)");
    } else {
      if (mustExist) throw new Error("file not found");
      let parent = path.dirname(abs);
      while (!fs.existsSync(parent)) parent = path.dirname(parent);
      if (!inside(fs.realpathSync(parent))) throw new Error("path is outside the workspace (symlink)");
    }
    return abs;
  }

  const readText = (abs: string): string => {
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error("not a file");
    if (st.size > maxBytes) throw new Error(`file too large (${st.size} bytes, limit ${maxBytes})`);
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) throw new Error("binary file");
    return buf.toString("utf8");
  };

  function* walk(dir: string, depth: number): Generator<string> {
    if (depth < 0) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (denied.some((p) => p.test(entry.name)) || entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      yield abs + (entry.isDirectory() ? path.sep : "");
      if (entry.isDirectory()) yield* walk(abs, depth - 1);
    }
  }
  const relOut = (abs: string) => path.relative(base, abs).split(path.sep).join("/") + (abs.endsWith(path.sep) ? "/" : "");

  const tools: ToolDefinition[] = [
    {
      spec: {
        name: "read_file",
        description: "Read a UTF-8 text file from the workspace. Optional 1-based start_line/end_line.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1 },
            start_line: { type: "integer", minimum: 1 },
            end_line: { type: "integer", minimum: 1 },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
      handler: ({ path: p, start_line, end_line }) => {
        const text = readText(resolveSafe(p, true));
        if (start_line === undefined && end_line === undefined) return text;
        const lines = text.split(/\r?\n/);
        const s = Number(start_line ?? 1);
        const e = Number(end_line ?? lines.length);
        return lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join("\n");
      },
    },
    {
      spec: {
        name: "list_files",
        description: "List files and folders in the workspace (folders end with /).",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, depth: { type: "integer", minimum: 0, maximum: 10 } },
          additionalProperties: false,
        },
      },
      handler: ({ path: p, depth }) => {
        const dir = p ? resolveSafe(p, true) : base;
        if (!fs.statSync(dir).isDirectory()) throw new Error("not a folder");
        const out: string[] = [];
        for (const f of walk(dir, Number(depth ?? 2))) {
          out.push(relOut(f));
          if (out.length >= maxEntries) { out.push(`…(limit ${maxEntries} reached)`); break; }
        }
        return out.join("\n");
      },
    },
    {
      spec: {
        name: "search_text",
        description: "Find lines containing a text (case-insensitive) in workspace files.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", minLength: 1, maxLength: 200 },
            path: { type: "string" },
            max_results: { type: "integer", minimum: 1, maximum: 500 },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      handler: ({ query, path: p, max_results }) => {
        const dir = p ? resolveSafe(p, true) : base;
        const needle = String(query).toLowerCase();
        const limit = Number(max_results ?? 100);
        const hits: string[] = [];
        for (const f of walk(dir, 20)) {
          if (f.endsWith(path.sep)) continue;
          let text: string;
          try { text = readText(f); } catch { continue; }
          text.split(/\r?\n/).forEach((line, i) => {
            if (hits.length < limit && line.toLowerCase().includes(needle)) hits.push(`${relOut(f)}:${i + 1}: ${line.trim().slice(0, 300)}`);
          });
          if (hits.length >= limit) break;
        }
        return hits.length ? hits.join("\n") : "No matches.";
      },
    },
  ];

  if (opts.allowWrite) {
    tools.push({
      requiresApproval: true,
      spec: {
        name: "write_file",
        description: "Create or overwrite a UTF-8 text file in the workspace (needs user approval).",
        parameters: {
          type: "object",
          properties: { path: { type: "string", minLength: 1 }, content: { type: "string", maxLength: maxBytes } },
          required: ["path", "content"],
          additionalProperties: false,
        },
      },
      handler: ({ path: p, content }) => {
        const abs = resolveSafe(p, false);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(content), "utf8");
        return `Wrote ${Buffer.byteLength(String(content))} bytes to ${relOut(abs)}`;
      },
    });
  }
  return tools;
}
