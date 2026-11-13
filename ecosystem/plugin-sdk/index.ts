import { ToolDefinition } from "../../common/typescript/src";

/** extension.json — every extension ships one. */
export interface ExtensionManifest {
  /** Lowercase id, e.g. "arcad.rpg-helper". */
  id: string;
  name: string;
  version: string;
  publisher: string;
  description?: string;
  /** Entry file (JavaScript) relative to the extension folder. */
  main: string;
  /** Platform API version range, e.g. "^1.0.0". */
  engine: string;
  /** What the extension needs. The user approves these on install. */
  permissions: ExtensionPermission[];
  contributes?: {
    commands?: Array<{ id: string; title: string }>;
    tools?: string[];
  };
}

export type ExtensionPermission =
  | "workspace:read"
  | "workspace:write"
  | "network"
  | "terminal"
  | "secrets"
  | "ai:chat";

const PERMISSIONS: ExtensionPermission[] = ["workspace:read", "workspace:write", "network", "terminal", "secrets", "ai:chat"];

export function validateManifest(m: any): string[] {
  const errors: string[] = [];
  if (!m || typeof m !== "object") return ["manifest must be an object"];
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(m.id)) errors.push("id must be lowercase letters, digits, . _ - (3-64 chars)");
  for (const k of ["name", "version", "publisher", "main", "engine"]) if (typeof m[k] !== "string" || !m[k]) errors.push(`${k} is required`);
  if (typeof m.version === "string" && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version)) errors.push("version must be semver (1.2.3)");
  if (typeof m.main === "string" && (m.main.includes("..") || m.main.startsWith("/") || /^[a-z]:/i.test(m.main))) errors.push("main must be a relative path inside the extension");
  if (!Array.isArray(m.permissions)) errors.push("permissions must be an array");
  else for (const p of m.permissions) if (!PERMISSIONS.includes(p)) errors.push(`unknown permission: ${p}`);
  return errors;
}

/** What the platform gives an extension. Each call is checked against the manifest permissions. */
export interface ExtensionContext {
  readonly extensionId: string;
  readonly permissions: readonly ExtensionPermission[];
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): void;
  registerTool(tool: ToolDefinition): void;
  readFile(relPath: string): Promise<string>;
  writeFile(relPath: string, content: string): Promise<void>;
  getSecret(name: string): Promise<string | undefined>;
  chat(prompt: string): Promise<string>;
  log(message: string): void;
}

export interface Extension {
  activate(ctx: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/** Helper for extension authors: `export default defineExtension({ activate(ctx) { ... } })`. */
export function defineExtension(ext: Extension): Extension {
  return ext;
}

export interface HostServices {
  readFile(relPath: string): Promise<string>;
  writeFile(relPath: string, content: string): Promise<void>;
  getSecret(name: string): Promise<string | undefined>;
  chat(prompt: string): Promise<string>;
  log(extensionId: string, message: string): void;
}

/**
 * Builds the context handed to an extension. Anything the manifest did not declare throws,
 * so an extension can never silently gain access it was not approved for.
 */
export function createExtensionContext(
  manifest: ExtensionManifest,
  host: HostServices,
  registry: { commands: Map<string, (...a: unknown[]) => unknown>; tools: ToolDefinition[] },
): ExtensionContext {
  const need = (p: ExtensionPermission) => {
    if (!manifest.permissions.includes(p)) throw new Error(`Extension ${manifest.id} lacks permission "${p}"`);
  };
  return {
    extensionId: manifest.id,
    permissions: Object.freeze([...manifest.permissions]),
    registerCommand(id, handler) {
      const full = `${manifest.id}.${id}`;
      if (registry.commands.has(full)) throw new Error(`Command exists: ${full}`);
      registry.commands.set(full, handler);
    },
    registerTool(tool) {
      registry.tools.push({ ...tool, spec: { ...tool.spec, name: `${manifest.id.replace(/[^A-Za-z0-9_-]/g, "_")}__${tool.spec.name}`.slice(0, 64) } });
    },
    async readFile(p) { need("workspace:read"); return host.readFile(p); },
    async writeFile(p, c) { need("workspace:write"); return host.writeFile(p, c); },
    async getSecret(n) { need("secrets"); return host.getSecret(`${manifest.id}:${n}`); },
    async chat(prompt) { need("ai:chat"); return host.chat(prompt); },
    log(message) { host.log(manifest.id, message); },
  };
}
