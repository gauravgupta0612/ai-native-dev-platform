import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ScriptedProvider, tempDir, write } from "../helpers";
import { AuditLog } from "../../common/typescript/src";
import { createPlatform } from "../../apps/desktop-ide/platform";

test("end to end: open project, index, agent reads code, write needs approval, audit intact", async () => {
  const root = tempDir("proj-");
  write(root, "package.json", JSON.stringify({ name: "demo", scripts: { test: "node -e 0" } }));
  write(root, "src/orders.ts", 'import { tax } from "./tax";\nexport function total(x: number) { return x + tax(x); }\n');
  write(root, "src/tax.ts", "export function tax(x: number) { return x * 0.2; }\n");
  write(root, ".env", "OPENAI_API_KEY=");
  execFileSync("git", ["init", "-q"], { cwd: root });

  const model = new ScriptedProvider("scripted", [
    { toolCalls: [{ id: "1", name: "search_code", arguments: { query: "tax calculation" } }] },
    { toolCalls: [{ id: "2", name: "impact_analysis", arguments: { node: "file:src/tax.ts" } }] },
    { content: "tax() is in src/tax.ts and is used by src/orders.ts" },
    { toolCalls: [{ id: "3", name: "write_file", arguments: { path: "src/new.ts", content: "export {}" } }] },
    { content: "I could not write the file (not approved)." },
  ]);
  const asked: string[] = [];
  const platform = await createPlatform({
    projectRoot: root,
    appDataDir: tempDir("appdata-"),
    configDir: path.resolve(__dirname, "../../../config"),
    providers: [model],
    prompt: async (_s, perm) => { asked.push(perm); return "deny"; },
  });
  try {
    assert.equal(platform.project.kind, "node");
    const idx = await platform.reindex();
    assert.equal(idx.files, 3);

    const r = await platform.agents.ask("reader", "Where is tax calculated and who uses it?", platform.project);
    assert.equal(r.stoppedReason, "completed");
    assert.equal(r.toolCalls, 2);
    const impact = model.requests[2].messages.find((m) => m.role === "tool" && m.content.includes("orders"));
    assert.ok(impact, "impact analysis result was given to the model");

    const c = await platform.agents.ask("coder", "Create src/new.ts", platform.project);
    assert.equal(c.stoppedReason, "completed");
    assert.deepEqual(asked, ["tool:write_file"]);
    assert.equal(fs.existsSync(path.join(root, "src/new.ts")), false);

    assert.equal(AuditLog.verifyFile(path.join(root, ".aiplatform", "audit.jsonl")), -1);
    assert.ok(platform.routerInfo.providers.includes("scripted"));
  } finally {
    platform.dispose();
  }
});
