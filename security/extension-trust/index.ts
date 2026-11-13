import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface TrustedPublisher {
  id: string;
  /** Ed25519 public key, PEM. */
  publicKeyPem: string;
}

export interface SignatureFile {
  publisher: string;
  /** sha256 of every file in the extension folder (except signature.json). */
  files: Record<string, string>;
  /** Base64 Ed25519 signature over the canonical JSON of {publisher, files}. */
  signature: string;
}

export interface TrustResult {
  trusted: boolean;
  publisher?: string;
  reason: string;
}

const SIG_FILE = "signature.json";

function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`Symlinks are not allowed in extensions: ${e.name}`);
    if (e.isDirectory()) return listFiles(abs, base);
    const rel = path.relative(base, abs).split(path.sep).join("/");
    return rel === SIG_FILE ? [] : [rel];
  });
}

export function hashExtension(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of listFiles(dir).sort()) out[rel] = createHash("sha256").update(fs.readFileSync(path.join(dir, rel))).digest("hex");
  return out;
}

const payload = (publisher: string, files: Record<string, string>) =>
  Buffer.from(JSON.stringify({ publisher, files: Object.fromEntries(Object.entries(files).sort()) }));

/** For publishers: creates a key pair (keep the private key secret). */
export function createPublisherKeys(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** For publishers: signs an extension folder (writes signature.json). */
export function signExtension(dir: string, publisher: string, privateKeyPem: string): SignatureFile {
  const files = hashExtension(dir);
  const signature = sign(null, payload(publisher, files), privateKeyPem).toString("base64");
  const sig: SignatureFile = { publisher, files, signature };
  fs.writeFileSync(path.join(dir, SIG_FILE), JSON.stringify(sig, null, 2));
  return sig;
}

/**
 * Verifies an extension before it is loaded: the publisher must be trusted, the signature valid,
 * and every file must match its hash (no added, removed or changed files).
 */
export function verifyExtension(dir: string, trusted: TrustedPublisher[]): TrustResult {
  const sigPath = path.join(dir, SIG_FILE);
  if (!fs.existsSync(sigPath)) return { trusted: false, reason: "Extension is not signed" };
  let sig: SignatureFile;
  try {
    sig = JSON.parse(fs.readFileSync(sigPath, "utf8"));
  } catch {
    return { trusted: false, reason: "signature.json is unreadable" };
  }
  const pub = trusted.find((t) => t.id === sig.publisher);
  if (!pub) return { trusted: false, publisher: sig.publisher, reason: `Publisher is not trusted: ${sig.publisher}` };
  const okSig = verify(null, payload(sig.publisher, sig.files), pub.publicKeyPem, Buffer.from(sig.signature, "base64"));
  if (!okSig) return { trusted: false, publisher: sig.publisher, reason: "Invalid signature" };
  let actual: Record<string, string>;
  try {
    actual = hashExtension(dir);
  } catch (e) {
    return { trusted: false, publisher: sig.publisher, reason: (e as Error).message };
  }
  const names = new Set([...Object.keys(actual), ...Object.keys(sig.files)]);
  for (const n of names) {
    if (actual[n] !== sig.files[n]) return { trusted: false, publisher: sig.publisher, reason: `File changed, added or removed: ${n}` };
  }
  return { trusted: true, publisher: sig.publisher, reason: "Signature and files verified" };
}
