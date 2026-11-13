import * as fs from "node:fs";
import * as path from "node:path";
import { TrustedPublisher, verifyExtension } from "../../security/extension-trust";
import { ExtensionManifest, validateManifest } from "../../ecosystem/plugin-sdk";

export interface InstalledExtension {
  manifest: ExtensionManifest;
  dir: string;
  enabled: boolean;
  publisher: string;
}

export interface MarketplaceOptions {
  /** Folder where extensions are installed. */
  installDir: string;
  trustedPublishers: TrustedPublisher[];
  /** Allow unsigned extensions (development only). Default false. */
  allowUnsigned?: boolean;
}

/**
 * Installs, lists, enables and removes extensions. Every install is checked:
 * valid manifest + trusted signature (unless allowUnsigned) + no file changes.
 */
export class ExtensionMarketplace {
  private readonly stateFile: string;
  private state: Record<string, { enabled: boolean }> = {};

  constructor(private readonly opts: MarketplaceOptions) {
    fs.mkdirSync(opts.installDir, { recursive: true });
    this.stateFile = path.join(opts.installDir, "extensions.json");
    if (fs.existsSync(this.stateFile)) this.state = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
  }

  /** Installs from a local folder (downloaded and unpacked package). */
  install(sourceDir: string): InstalledExtension {
    const manifest = readManifest(sourceDir);
    const trust = verifyExtension(sourceDir, this.opts.trustedPublishers);
    if (!trust.trusted && !this.opts.allowUnsigned) throw new Error(`Extension rejected: ${trust.reason}`);
    const target = path.join(this.opts.installDir, manifest.id);
    if (!path.resolve(target).startsWith(path.resolve(this.opts.installDir) + path.sep)) throw new Error("Invalid extension id");
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(sourceDir, target, { recursive: true });
    this.state[manifest.id] = { enabled: true };
    this.saveState();
    return { manifest, dir: target, enabled: true, publisher: trust.publisher ?? "unsigned" };
  }

  list(): InstalledExtension[] {
    return Object.keys(this.state)
      .map((id) => path.join(this.opts.installDir, id))
      .filter((dir) => fs.existsSync(path.join(dir, "extension.json")))
      .map((dir) => {
        const manifest = readManifest(dir);
        const trust = verifyExtension(dir, this.opts.trustedPublishers);
        return { manifest, dir, enabled: this.state[manifest.id]?.enabled ?? false, publisher: trust.publisher ?? "unsigned" };
      });
  }

  setEnabled(id: string, enabled: boolean): void {
    if (!this.state[id]) throw new Error(`Not installed: ${id}`);
    this.state[id].enabled = enabled;
    this.saveState();
  }

  uninstall(id: string): void {
    const dir = path.join(this.opts.installDir, id);
    if (!path.resolve(dir).startsWith(path.resolve(this.opts.installDir) + path.sep)) throw new Error("Invalid extension id");
    fs.rmSync(dir, { recursive: true, force: true });
    delete this.state[id];
    this.saveState();
  }

  /** Re-checks signatures of enabled extensions before loading them (detects tampering after install). */
  verifyEnabled(): Array<{ id: string; ok: boolean; reason: string }> {
    return this.list()
      .filter((e) => e.enabled)
      .map((e) => {
        const t = verifyExtension(e.dir, this.opts.trustedPublishers);
        return { id: e.manifest.id, ok: t.trusted || !!this.opts.allowUnsigned, reason: t.reason };
      });
  }

  private saveState(): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }
}

export function readManifest(dir: string): ExtensionManifest {
  const file = path.join(dir, "extension.json");
  if (!fs.existsSync(file)) throw new Error("extension.json not found");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(`Invalid extension.json: ${problems.join("; ")}`);
  return manifest as ExtensionManifest;
}
