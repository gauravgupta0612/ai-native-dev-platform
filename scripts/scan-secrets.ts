/**
 * Fails (exit 1) if tracked files contain API keys, tokens or private keys.
 * Run before every commit:  npm run scan-secrets
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { redactSecrets } from "../common/typescript/src";

const IGNORE = [/^common\/.*\/test/, /\.(png|jpg|jpeg|gif|ico|pdf|zip|jar|exe|msi)$/i, /^SECURITY\.md$/, /tests\//];

function trackedFiles(): string[] {
  try {
    return execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

let problems = 0;
for (const file of trackedFiles()) {
  if (IGNORE.some((r) => r.test(file)) || !fs.existsSync(file) || fs.statSync(file).size > 2_000_000) continue;
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("\0")) continue;
  text.split(/\r?\n/).forEach((line, i) => {
    const masked = redactSecrets(line, false);
    // ignore documentation placeholders such as KEY=... or KEY=xxxx
    if (masked !== line && !/=\s*(\.\.\.|xxxx|<[^>]+>|\$\{?\w+\}?)?\s*$/.test(line)) {
      console.log(`${file}:${i + 1}: possible secret -> ${masked.trim().slice(0, 120)}`);
      problems++;
    }
  });
}
if (problems) {
  console.log(`\n${problems} possible secret(s) found. Remove them and revoke the keys.`);
  process.exit(1);
}
console.log("No secrets found in tracked files.");
