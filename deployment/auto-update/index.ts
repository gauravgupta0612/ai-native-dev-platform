import { createHash, verify } from "node:crypto";
import * as fs from "node:fs";
import { assertSecureUrl } from "../../common/typescript/src/models/providers/http";

/** latest.json published next to each release. */
export interface UpdateManifest {
  version: string;
  releasedAt: string;
  notes?: string;
  /** Per platform: download URL + sha256 of the file. */
  assets: Record<"win32" | "linux" | "darwin", { url: string; sha256: string } | undefined>;
  /** Base64 Ed25519 signature of the manifest without this field (canonical JSON). */
  signature: string;
}

export type Channel = "stable" | "beta";

/** Compares semantic versions (1.2.3, 1.2.3-beta.1). Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: main.split(".").map((n) => parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) > (y.nums[i] ?? 0) ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]))
  : v;

/** Bytes that are signed: the manifest without `signature`, keys sorted at every level. */
export const canonicalManifest = (m: UpdateManifest) => {
  const { signature: _s, ...rest } = m;
  return Buffer.from(JSON.stringify(sortKeys(rest)));
};

/**
 * Secure auto-update check: HTTPS only, manifest signed with the release key (Ed25519),
 * download verified with SHA-256 before it is handed to the installer.
 */
export class UpdateChecker {
  constructor(
    private readonly manifestUrl: string,
    private readonly currentVersion: string,
    private readonly releasePublicKeyPem: string,
    private readonly channel: Channel = "stable",
  ) {
    assertSecureUrl("updater", manifestUrl);
  }

  verifyManifest(m: UpdateManifest): boolean {
    try {
      return verify(null, canonicalManifest(m), this.releasePublicKeyPem, Buffer.from(m.signature, "base64"));
    } catch {
      return false;
    }
  }

  async check(): Promise<{ available: boolean; manifest?: UpdateManifest; reason?: string }> {
    const res = await fetch(this.manifestUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
    const m = (await res.json()) as UpdateManifest;
    if (!this.verifyManifest(m)) return { available: false, reason: "Manifest signature invalid — update refused" };
    if (this.channel === "stable" && m.version.includes("-")) return { available: false, reason: "Pre-release skipped on stable channel" };
    return compareVersions(m.version, this.currentVersion) > 0 ? { available: true, manifest: m } : { available: false, reason: "Up to date" };
  }

  /** Downloads the asset for this OS and verifies its SHA-256. Returns the file path. */
  async download(m: UpdateManifest, targetFile: string): Promise<string> {
    const asset = m.assets[process.platform as "win32" | "linux" | "darwin"];
    if (!asset) throw new Error(`No update for ${process.platform}`);
    assertSecureUrl("updater", asset.url);
    const res = await fetch(asset.url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = createHash("sha256").update(buf).digest("hex");
    if (hash !== asset.sha256.toLowerCase()) throw new Error("Checksum mismatch — download discarded");
    fs.writeFileSync(targetFile, buf);
    return targetFile;
  }
}
