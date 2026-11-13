import * as fs from "node:fs";
import * as path from "node:path";
import { WorkspaceFile } from "../../core/workspace-engine";

export interface LanguageStats {
  files: number;
  lines: number;
  bytes: number;
}

export interface ProjectReport {
  totalFiles: number;
  totalLines: number;
  byLanguage: Record<string, LanguageStats>;
  largestFiles: Array<{ path: string; lines: number }>;
  todoCount: number;
  todos: Array<{ path: string; line: number; text: string }>;
  dependencies: Record<string, string[]>;
  findings: string[];
}

const EXT_LANG: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".java": "Java", ".py": "Python", ".rpgle": "RPGLE",
  ".sqlrpgle": "RPGLE", ".clle": "CL", ".sql": "SQL", ".cs": "C#", ".go": "Go", ".kt": "Kotlin", ".html": "HTML",
  ".css": "CSS", ".md": "Markdown", ".json": "JSON", ".xml": "XML", ".yml": "YAML", ".yaml": "YAML",
};

function deps(root: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const read = (f: string) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : undefined);
  const pkg = read("package.json");
  if (pkg) {
    const j = JSON.parse(pkg);
    out.npm = Object.keys({ ...j.dependencies, ...j.devDependencies });
  }
  const pom = read("pom.xml");
  if (pom) out.maven = [...pom.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)].map((m) => `${m[1]}:${m[2]}`);
  const req = read("requirements.txt");
  if (req) out.pip = req.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return out;
}

/** Static overview of a project: languages, size, largest files, TODO/FIXME, dependencies, simple findings. */
export function analyzeProject(root: string, files: WorkspaceFile[], maxFileBytes = 1_000_000): ProjectReport {
  const rep: ProjectReport = { totalFiles: 0, totalLines: 0, byLanguage: {}, largestFiles: [], todoCount: 0, todos: [], dependencies: deps(root), findings: [] };
  const sizes: Array<{ path: string; lines: number }> = [];
  for (const f of files) {
    const lang = EXT_LANG[path.extname(f.path).toLowerCase()];
    if (!lang || f.size > maxFileBytes) continue;
    const text = fs.readFileSync(path.join(f.root, f.path), "utf8");
    const lines = text.split(/\r?\n/);
    rep.totalFiles++;
    rep.totalLines += lines.length;
    const s = (rep.byLanguage[lang] ??= { files: 0, lines: 0, bytes: 0 });
    s.files++; s.lines += lines.length; s.bytes += f.size;
    sizes.push({ path: f.path, lines: lines.length });
    lines.forEach((l, i) => {
      if (/\b(TODO|FIXME|HACK|XXX)\b/.test(l)) {
        rep.todoCount++;
        if (rep.todos.length < 100) rep.todos.push({ path: f.path, line: i + 1, text: l.trim().slice(0, 160) });
      }
    });
  }
  rep.largestFiles = sizes.sort((a, b) => b.lines - a.lines).slice(0, 10);
  for (const big of rep.largestFiles.filter((f) => f.lines > 1000)) rep.findings.push(`Large file (${big.lines} lines): ${big.path} — consider splitting`);
  if (!files.some((f) => /(^|\/)(test|tests|__tests__|src\/test)\//i.test(f.path) || /\.(test|spec)\.\w+$/.test(f.path))) rep.findings.push("No tests found");
  if (!files.some((f) => /^readme/i.test(path.basename(f.path)))) rep.findings.push("No README found");
  if (rep.todoCount > 50) rep.findings.push(`${rep.todoCount} TODO/FIXME comments`);
  return rep;
}
