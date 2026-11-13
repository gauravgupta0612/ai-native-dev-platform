import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tempDir, write } from "../helpers";
import { ProjectManager, detectKind } from "../../core/project-manager";
import { WorkspaceEngine } from "../../core/workspace-engine";
import { GitService } from "../../core/git-integration";
import { TerminalManager } from "../../core/terminal-manager";
import { ExtensionMarketplace } from "../../core/extension-marketplace";
import { createPublisherKeys, signExtension } from "../../security/extension-trust";

test("project manager: detect, create, open, update, recent", () => {
  const root = tempDir();
  write(root, "pom.xml", "<project/>");
  assert.equal(detectKind(root), "java-maven");
  const pm = new ProjectManager(tempDir());
  const p = pm.create(root, "Demo");
  assert.equal(p.kind, "java-maven");
  const p2 = pm.update(p, { localOnly: true });
  assert.equal(pm.open(root).localOnly, true);
  assert.equal(p2.name, "Demo");
  assert.deepEqual(pm.recent(), [path.resolve(root)]);
});

test("workspace engine: index skips secrets and build output; open files feed context", () => {
  const root = tempDir();
  write(root, "src/a.ts", "export const a = 1;");
  write(root, ".env", "KEY=1");
  write(root, "node_modules/x/index.js", "");
  write(root, "dist/a.js", "");
  const ws = new WorkspaceEngine();
  ws.addRoot(root);
  assert.deepEqual(ws.index().map((f) => f.path), ["src/a.ts"]);
  ws.openFile("src/a.ts");
  assert.equal(ws.openFileSnippets().length, 1);
  assert.throws(() => ws.resolve("../../etc/passwd"));
});

test("git integration: status, commit, log, branch validation", async () => {
  const root = tempDir();
  execFileSync("git", ["init", "-q"], { cwd: root });
  write(root, "a.txt", "hello");
  const git = new GitService(root);
  assert.equal(await git.isRepo(), true);
  assert.equal((await git.status())[0].path, "a.txt");
  await git.add(["a.txt"]);
  await git.commit("first", { name: "gauravgupta0612", email: "test@example.invalid" });
  assert.equal((await git.log(5))[0].subject, "first");
  await assert.rejects(git.createBranch("--evil"));
  await git.createBranch("feature/x");
  assert.equal(await git.currentBranch(), "feature/x");
});

test("terminal manager: sessions run through the sandbox", async () => {
  const root = tempDir();
  write(root, "calc.js", "console.log(6 * 7)");
  const tm = new TerminalManager({ allowedCommands: ["node"], workspaceRoot: root });
  const s = tm.open();
  const r = await tm.run(s.id, "node", ["calc.js"]);
  assert.equal(r.stdout.trim(), "42");
  await assert.rejects(tm.run(s.id, "bash", ["-c", "id"]), /not allowed/);
  assert.equal(tm.tool().requiresApproval, true);
});

test("extension marketplace: signed install, unsigned rejected, enable/disable, uninstall", () => {
  const src = tempDir();
  fs.cpSync(path.resolve(__dirname, "../../../ecosystem/extensions/hello-world"), src, { recursive: true });
  const keys = createPublisherKeys();
  const install = tempDir();
  const mp = new ExtensionMarketplace({ installDir: install, trustedPublishers: [{ id: "samples", publicKeyPem: keys.publicKeyPem }] });
  assert.throws(() => mp.install(src), /not signed/);
  signExtension(src, "samples", keys.privateKeyPem);
  const ext = mp.install(src);
  assert.equal(ext.manifest.id, "samples.hello-world");
  assert.equal(mp.list()[0].enabled, true);
  mp.setEnabled("samples.hello-world", false);
  assert.equal(mp.list()[0].enabled, false);
  assert.deepEqual(mp.verifyEnabled(), []);
  mp.uninstall("samples.hello-world");
  assert.equal(mp.list().length, 0);
});
