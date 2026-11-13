import * as fs from "node:fs";
import * as path from "node:path";

export type ProjectKind = "node" | "java-maven" | "java-gradle" | "python" | "ibmi" | "dotnet" | "unknown";

export interface ProjectSettings {
  name: string;
  kind: ProjectKind;
  /** Preferred provider for this project, e.g. "anthropic" or "ollama". */
  defaultProvider?: string;
  /** Keep all AI traffic on the local model (customer code, regulated data). */
  localOnly?: boolean;
  /** Extra folders/files the agent must never read. */
  excludePatterns?: string[];
  createdAt: string;
}

export interface ProjectInfo extends ProjectSettings {
  root: string;
}

const SETTINGS_DIR = ".aiplatform";
const SETTINGS_FILE = "project.json";

/** Detects the project type from well-known files. */
export function detectKind(root: string): ProjectKind {
  const has = (f: string) => fs.existsSync(path.join(root, f));
  if (has("pom.xml")) return "java-maven";
  if (has("build.gradle") || has("build.gradle.kts")) return "java-gradle";
  if (has("package.json")) return "node";
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) return "python";
  if (has("iproj.json") || has(".ibmi.json") || has("QRPGLESRC")) return "ibmi";
  if (fs.existsSync(root) && fs.readdirSync(root).some((f) => /\.(sln|csproj)$/i.test(f))) return "dotnet";
  return "unknown";
}

/** Opens, creates and remembers projects. Settings live in <project>/.aiplatform/project.json. */
export class ProjectManager {
  private readonly recentFile: string;

  constructor(private readonly appDataDir: string) {
    fs.mkdirSync(appDataDir, { recursive: true });
    this.recentFile = path.join(appDataDir, "recent-projects.json");
  }

  open(root: string): ProjectInfo {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
    const file = path.join(abs, SETTINGS_DIR, SETTINGS_FILE);
    const settings: ProjectSettings = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : { name: path.basename(abs), kind: detectKind(abs), createdAt: new Date().toISOString() };
    this.remember(abs);
    return { ...settings, root: abs };
  }

  create(root: string, name?: string, opts: Partial<ProjectSettings> = {}): ProjectInfo {
    const abs = path.resolve(root);
    fs.mkdirSync(path.join(abs, SETTINGS_DIR), { recursive: true });
    const settings: ProjectSettings = {
      name: name ?? path.basename(abs),
      kind: detectKind(abs),
      createdAt: new Date().toISOString(),
      ...opts,
    };
    this.save(abs, settings);
    this.remember(abs);
    return { ...settings, root: abs };
  }

  update(project: ProjectInfo, changes: Partial<ProjectSettings>): ProjectInfo {
    const { root, ...current } = project;
    const next = { ...current, ...changes };
    this.save(root, next);
    return { ...next, root };
  }

  recent(): string[] {
    if (!fs.existsSync(this.recentFile)) return [];
    return (JSON.parse(fs.readFileSync(this.recentFile, "utf8")) as string[]).filter((p) => fs.existsSync(p));
  }

  private save(root: string, settings: ProjectSettings): void {
    fs.mkdirSync(path.join(root, SETTINGS_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, SETTINGS_DIR, SETTINGS_FILE), JSON.stringify(settings, null, 2));
  }

  private remember(root: string): void {
    const list = [root, ...this.recent().filter((p) => p !== root)].slice(0, 20);
    fs.writeFileSync(this.recentFile, JSON.stringify(list, null, 2));
  }
}
