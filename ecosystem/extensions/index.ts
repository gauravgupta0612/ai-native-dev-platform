import * as path from "node:path";
import { ToolDefinition } from "../../common/typescript/src";
import { InstalledExtension } from "../../core/extension-marketplace";
import { Extension, HostServices, createExtensionContext } from "../plugin-sdk";

export interface LoadedExtensions {
  commands: Map<string, (...a: unknown[]) => unknown>;
  tools: ToolDefinition[];
  active: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Loads enabled extensions and activates them with a permission-checked context.
 * Only pass extensions returned by ExtensionMarketplace (already signature-verified).
 */
export async function loadExtensions(installed: InstalledExtension[], host: HostServices): Promise<LoadedExtensions> {
  const result: LoadedExtensions = { commands: new Map(), tools: [], active: [], failed: [] };
  for (const ext of installed.filter((e) => e.enabled)) {
    try {
      const entry = path.resolve(ext.dir, ext.manifest.main);
      if (!entry.startsWith(path.resolve(ext.dir) + path.sep)) throw new Error("main points outside the extension");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(entry);
      const impl: Extension = mod.default ?? mod;
      await impl.activate(createExtensionContext(ext.manifest, host, result));
      result.active.push(ext.manifest.id);
    } catch (e) {
      result.failed.push({ id: ext.manifest.id, error: (e as Error).message });
    }
  }
  return result;
}
