import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { tempDir, write } from "../helpers";
import { McpClient } from "../../ecosystem/mcp-servers";
import { createExtensionContext, validateManifest } from "../../ecosystem/plugin-sdk";
import { loadExtensions } from "../../ecosystem/extensions";
import { readManifest } from "../../core/extension-marketplace";
import { GitHubIntegration, JiraIntegration } from "../../ecosystem/integrations";
import { EnvSecretStore } from "../../security/secure-storage";

const FAKE_MCP_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }, { name: "hidden" }] } });
  else if (msg.method === "tools/call") send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "echo: " + msg.params.arguments.text }] } });
  else send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not found" } });
});`;

test("MCP client: initialize, list (filtered), call, adapt to platform tools", async () => {
  const dir = tempDir();
  const script = write(dir, "server.js", FAKE_MCP_SERVER);
  const c = new McpClient("fake", { command: process.execPath, args: [script], allowedTools: ["echo"] });
  await c.start();
  try {
    assert.deepEqual((await c.listTools()).map((t) => t.name), ["echo"]);
    assert.equal(await c.callTool("echo", { text: "hi" }), "echo: hi");
    const defs = await c.toToolDefinitions();
    assert.equal(defs[0].spec.name, "fake__echo");
    assert.equal(defs[0].requiresApproval, true);
    assert.equal(await defs[0].handler({ text: "x" }), "echo: x");
  } finally {
    c.stop();
  }
});

test("plugin SDK: manifest validation and permission enforcement", async () => {
  assert.equal(validateManifest(readManifestSample()).length, 0);
  assert.ok(validateManifest({ id: "Bad Id", permissions: ["root"] }).length > 3);
  const registry = { commands: new Map(), tools: [] as any[] };
  const host = { readFile: async () => "a\nb", writeFile: async () => {}, getSecret: async () => "s", chat: async () => "c", log: () => {} };
  const ctx = createExtensionContext(readManifestSample(), host, registry);
  assert.equal(await ctx.readFile("x"), "a\nb");
  await assert.rejects(ctx.writeFile("x", "y"), /lacks permission "workspace:write"/);
  await assert.rejects(ctx.getSecret("k"), /lacks permission "secrets"/);
});

test("extension loader: activates the hello-world sample", async () => {
  const dir = tempDir();
  fs.cpSync(path.resolve(__dirname, "../../../ecosystem/extensions/hello-world"), dir, { recursive: true });
  const host = { readFile: async () => "1\n2\n3", writeFile: async () => {}, getSecret: async () => undefined, chat: async () => "", log: () => {} };
  const loaded = await loadExtensions([{ manifest: readManifest(dir), dir, enabled: true, publisher: "samples" }], host);
  assert.deepEqual(loaded.active, ["samples.hello-world"]);
  assert.equal(loaded.commands.get("samples.hello-world.sayHello")!("Gaurav"), "Hello Gaurav from samples.hello-world!");
  assert.deepEqual(await loaded.tools[0].handler({ path: "a.txt" }), { path: "a.txt", lines: 3 });
});

test("integrations: input validation and https enforcement", async () => {
  const jira = new JiraIntegration("http://jira.internal", new EnvSecretStore());
  await assert.rejects(jira.getIssue("not a key"), /Invalid issue key/);
  process.env.JIRA_PAT = "x";
  await assert.rejects(jira.getIssue("TMS-1"), /Insecure URL/);
  delete process.env.JIRA_PAT;
  await assert.rejects(new GitHubIntegration(new EnvSecretStore()).listIssues("../etc"), /owner\/name/);
});

function readManifestSample() {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../ecosystem/extensions/hello-world/extension.json"), "utf8"));
}
