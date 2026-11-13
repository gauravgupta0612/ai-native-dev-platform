import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import "../helpers";
import { tempDir, write } from "../helpers";
import { PermissionManager } from "../../security/permission-control";
import { CommandSandbox } from "../../security/sandbox";
import { DataPrivacy } from "../../security/data-privacy";
import { ChainedSecretStore, EncryptedFileSecretStore, EnvSecretStore } from "../../security/secure-storage";
import { createPublisherKeys, signExtension, verifyExtension } from "../../security/extension-trust";
import { AuditLog, integrityReport, queryAudit, readAuditFile } from "../../security/audit-log";

test("permissions: deny by default, grants, scopes, once, wildcard, expiry", async () => {
  let now = 1000;
  const pm = new PermissionManager(undefined, () => now);
  assert.equal(await pm.request("agent", "tool:write_file", "src/a.ts"), false);
  pm.grant({ subject: "agent", permission: "tool:write_file", scope: "src/" });
  assert.equal(await pm.request("agent", "tool:write_file", "src/a.ts"), true);
  assert.equal(await pm.request("agent", "tool:write_file", "secrets/a.ts"), false);
  pm.grant({ subject: "*", permission: "network:*", once: true });
  assert.equal(await pm.request("x", "network:api.github.com"), true);
  assert.equal(await pm.request("x", "network:api.github.com"), false); // used up
  pm.grant({ subject: "agent", permission: "command:git", expiresAt: 2000 });
  assert.equal(pm.has("agent", "command:git"), true);
  now = 3000;
  assert.equal(pm.has("agent", "command:git"), false);
});

test("permissions: prompt answers are respected and remembered", async () => {
  let asked = 0;
  const pm = new PermissionManager(async () => { asked++; return "allow-always"; });
  assert.equal(await pm.request("a", "tool:run_command"), true);
  assert.equal(await pm.request("a", "tool:run_command"), true);
  assert.equal(asked, 1);
});

test("sandbox: allow-list, no shell metacharacters, cwd confinement, env scrubbing", async () => {
  const root = tempDir();
  const sb = new CommandSandbox({ allowedCommands: ["node"], workspaceRoot: root });
  assert.match(sb.check("rm", ["-rf", "/"]) ?? "", /not allowed/);
  assert.match(sb.check("node", ["-e", "1; rm -rf /"]) ?? "", /Argument not allowed/);
  assert.match(sb.check("/usr/bin/node", []) ?? "", /command name/);
  assert.match(sb.check("node", [], "../..") ?? "", /outside/);
  write(root, "env.js", "console.log(process.env.OPENAI_API_KEY ? 'leaked' : 'no-key')");
  process.env.OPENAI_API_KEY = "sk-test-should-not-leak-1234567890";
  const r = await sb.run("node", ["env.js"]);
  delete process.env.OPENAI_API_KEY;
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout.trim(), "no-key");
});

test("sandbox: timeout kills long commands", async () => {
  const root = tempDir();
  write(root, "slow.js", "setTimeout(function () {}, 5000)");
  const sb = new CommandSandbox({ allowedCommands: ["node"], workspaceRoot: root, timeoutMs: 300 });
  const r = await sb.run("node", ["slow.js"]);
  assert.equal(r.timedOut, true);
});

test("data privacy: classifies and masks personal data", () => {
  const dp = new DataPrivacy();
  const c = dp.classify("Card 4111 1111 1111 1111, mail john@corp.com");
  assert.equal(c.level, "restricted");
  assert.equal(c.keepLocal, true);
  assert.equal(dp.classify("How do I sort an array?").level, "public");
  const m = dp.mask("Call +33 6 12 34 56 78 or pay to card 4111111111111111");
  assert.ok(!m.includes("4111111111111111") && !m.includes("12 34 56"), m);
});

test("secure storage: encrypted vault round-trip, wrong password, tamper detection", () => {
  const file = path.join(tempDir(), "vault.json");
  const v = new EncryptedFileSecretStore(file, "correct horse battery");
  v.set("JIRA_TOKEN", "super-secret-value");
  assert.ok(!fs.readFileSync(file, "utf8").includes("super-secret-value"));
  assert.equal(new EncryptedFileSecretStore(file, "correct horse battery").get("JIRA_TOKEN"), "super-secret-value");
  assert.throws(() => new EncryptedFileSecretStore(file, "wrong password!!"), /Cannot decrypt/);
  assert.throws(() => new EncryptedFileSecretStore(file, "short"), /at least 12/);
  process.env.TEST_SECRET_X = "from-env";
  assert.equal(new ChainedSecretStore([new EnvSecretStore(), v]).get("TEST_SECRET_X"), "from-env");
  delete process.env.TEST_SECRET_X;
});

test("extension trust: signed ok, tampered or untrusted rejected", () => {
  const dir = tempDir();
  write(dir, "extension.json", "{}");
  write(dir, "main.js", "module.exports={}");
  const keys = createPublisherKeys();
  signExtension(dir, "arcad", keys.privateKeyPem);
  const trusted = [{ id: "arcad", publicKeyPem: keys.publicKeyPem }];
  assert.equal(verifyExtension(dir, trusted).trusted, true);
  assert.equal(verifyExtension(dir, []).trusted, false);
  write(dir, "main.js", "module.exports={evil:true}");
  assert.match(verifyExtension(dir, trusted).reason, /changed/);
});

test("audit-log helpers: query and integrity", () => {
  const file = path.join(tempDir(), "audit.jsonl");
  const log = new AuditLog(file);
  log.record("a", "tool.call", { tool: "read_file" });
  log.record("b", "run.completed");
  assert.equal(queryAudit(readAuditFile(file), { actor: "a" }).length, 1);
  assert.deepEqual(integrityReport(file), { ok: true, events: 2, brokenAt: -1 });
});
