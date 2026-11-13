import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Where API keys and tokens live. Code asks the store; keys never sit in source files or settings. */
export interface SecretStore {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): boolean;
  list(): string[];
}

/** Reads secrets from environment variables (CI, containers, .env loaded by loadDotEnv). Read-only. */
export class EnvSecretStore implements SecretStore {
  constructor(private readonly prefix = "") {}
  get(name: string) { return process.env[this.prefix + name] || undefined; }
  set(): void { throw new Error("EnvSecretStore is read-only"); }
  delete(): boolean { throw new Error("EnvSecretStore is read-only"); }
  list() { return Object.keys(process.env).filter((k) => k.startsWith(this.prefix)).map((k) => k.slice(this.prefix.length)); }
}

interface VaultFile {
  version: 1;
  salt: string;
  entries: Record<string, { iv: string; tag: string; data: string }>;
}

/**
 * Encrypted local vault: AES-256-GCM, key derived from a master password with scrypt.
 * Each secret has its own random IV; GCM tags detect tampering. File is written with 0600 permissions.
 */
export class EncryptedFileSecretStore implements SecretStore {
  private readonly key: Buffer;
  private vault: VaultFile;

  constructor(private readonly filePath: string, masterPassword: string) {
    if (!masterPassword || masterPassword.length < 12) throw new Error("Master password must be at least 12 characters");
    if (fs.existsSync(filePath)) {
      this.vault = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } else {
      this.vault = { version: 1, salt: randomBytes(16).toString("base64"), entries: {} };
    }
    this.key = scryptSync(masterPassword, Buffer.from(this.vault.salt, "base64"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    // Fail fast on a wrong password instead of on first read.
    const first = Object.keys(this.vault.entries)[0];
    if (first) this.get(first);
  }

  get(name: string): string | undefined {
    const e = this.vault.entries[name];
    if (!e) return undefined;
    try {
      const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(e.iv, "base64"));
      d.setAAD(Buffer.from(name));
      d.setAuthTag(Buffer.from(e.tag, "base64"));
      return Buffer.concat([d.update(Buffer.from(e.data, "base64")), d.final()]).toString("utf8");
    } catch {
      throw new Error("Cannot decrypt secret: wrong master password or the vault was modified");
    }
  }

  set(name: string, value: string): void {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(name));
    const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
    this.vault.entries[name] = { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
    this.save();
  }

  delete(name: string): boolean {
    const had = name in this.vault.entries;
    delete this.vault.entries[name];
    if (had) this.save();
    return had;
  }

  list(): string[] { return Object.keys(this.vault.entries); }

  private save(): void {
    fs.mkdirSync(path.dirname(path.resolve(this.filePath)), { recursive: true });
    const tmp = this.filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.vault, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }
}

/** Tries several stores in order (e.g. env first, then the vault). Writes go to the last writable one. */
export class ChainedSecretStore implements SecretStore {
  constructor(private readonly stores: SecretStore[]) {}
  get(name: string) { for (const s of this.stores) { const v = s.get(name); if (v) return v; } return undefined; }
  set(name: string, value: string) { this.stores[this.stores.length - 1].set(name, value); }
  delete(name: string) { return this.stores[this.stores.length - 1].delete(name); }
  list() { return [...new Set(this.stores.flatMap((s) => { try { return s.list(); } catch { return []; } }))]; }
}
