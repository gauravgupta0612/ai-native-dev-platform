import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import * as http from "node:http";
import { AddressInfo } from "node:net";
import { ScriptedProvider, tempDir, write } from "../helpers";
import { ModelRouter } from "../../common/typescript/src";
import { CodeGenerator, extractCodeBlocks } from "../../features/code-generation";
import { detectTestCommand, parseFailures } from "../../features/debug-and-test";
import { analyzeProject } from "../../features/project-analysis";
import { WorkflowEngine, renderPrompt, WORKFLOWS } from "../../features/multi-agent-workflows";
import { WorkspaceEngine } from "../../core/workspace-engine";
import { mergePolicies, validatePolicy } from "../../enterprise/enterprise-policies";
import { buildUsageReport, toCsv } from "../../enterprise/advanced-analytics";
import { RateLimiter, createPlatformServer, hashApiKey } from "../../enterprise/scalable-architecture";
import { PROFILES, profileFromEnv } from "../../enterprise/custom-deployment";
import { UpdateChecker, canonicalManifest, compareVersions, UpdateManifest } from "../../deployment/auto-update";

test("code generation: extracts code and masks secrets in the prompt", async () => {
  assert.deepEqual(extractCodeBlocks("x\n```ts\nconst a = 1;\n```\n"), [{ language: "ts", code: "const a = 1;\n" }]);
  const p = new ScriptedProvider("p", [{ content: "```java\nclass A {}\n```" }]);
  const gen = new CodeGenerator(new ModelRouter().register(p));
  const r = await gen.generate("Create class A, key sk-abcdefghijklmnopqrstuvwx", { language: "java" });
  assert.equal(r.code?.language, "java");
  assert.ok(!JSON.stringify(p.requests[0]).includes("sk-abcdefghijklmnop"));
});

test("debug & test: detect runners and parse failures", () => {
  const root = tempDir();
  write(root, "pom.xml", "<project/>");
  assert.equal(detectTestCommand(root)?.framework, "maven");
  assert.equal(parseFailures("ok 1 - a\nnot ok 2 - adds numbers\n  expected 3").length, 1);
  assert.equal(parseFailures("FAILED tests/test_x.py::test_add - assert 1 == 2")[0].test, "tests/test_x.py::test_add");
});

test("project analysis: languages, todos, findings", () => {
  const root = tempDir();
  write(root, "src/a.ts", "// TODO fix\nconst a = 1;\n");
  write(root, "package.json", JSON.stringify({ dependencies: { express: "1" } }));
  const ws = new WorkspaceEngine();
  ws.addRoot(root);
  const rep = analyzeProject(root, ws.index());
  assert.equal(rep.byLanguage.TypeScript.files, 1);
  assert.equal(rep.todoCount, 1);
  assert.deepEqual(rep.dependencies.npm, ["express"]);
  assert.ok(rep.findings.includes("No tests found"));
});

test("multi-agent workflow: passes outputs forward and runs conditional steps", async () => {
  assert.equal(renderPrompt("A {{input}} B {{steps.x}}", "in", { x: "out" }), "A in B out");
  const outputs = ["PLAN", "CODE", "CHANGES NEEDED: rename", "FIXED"];
  const fake = { ask: async () => ({ output: outputs.shift()!, steps: 1, toolCalls: 0, usage: { inputTokens: 1, outputTokens: 1 }, stoppedReason: "completed" as const, routedLocal: false }) };
  const run = await new WorkflowEngine(fake as any).run(WORKFLOWS["plan-implement-review"], "add login");
  assert.equal(run.outputs.fix, "FIXED");
  assert.equal(run.completed, true);
});

test("enterprise policies: later layers can only tighten", () => {
  const p = mergePolicies(
    { allowedTools: ["a", "b"], maxAgentSteps: 10, allowFileWrites: true, allowedCommands: ["git", "npm"] },
    { allowedTools: ["b", "c"], maxAgentSteps: 50, allowFileWrites: true, allowedCommands: ["npm", "rm"], localOnly: true },
  );
  assert.deepEqual(p.allowedTools, ["b"]);
  assert.equal(p.maxAgentSteps, 10);
  assert.equal(p.localOnly, true);
  assert.deepEqual(p.allowedCommands, ["npm"]);
  assert.equal(mergePolicies({ allowFileWrites: false }, { allowFileWrites: true }).allowFileWrites, false);
  assert.ok(validatePolicy({ blockedPatterns: ["("] }).length === 1);
});

test("analytics: report and csv", () => {
  const rep = buildUsageReport([
    { ts: "2026-11-13T10:00:00Z", agent: "reader-agent", stoppedReason: "completed", steps: 2, toolCalls: 1, inputTokens: 100, outputTokens: 50, durationMs: 10, provider: "anthropic", costUsd: 0.001 },
    { ts: "2026-11-13T11:00:00Z", agent: "coder-agent", stoppedReason: "budget", steps: 8, toolCalls: 9, inputTokens: 1000, outputTokens: 500, durationMs: 10, provider: "anthropic", costUsd: 0.01 },
  ]);
  assert.equal(rep.runs, 2);
  assert.equal(rep.completionRate, 0.5);
  assert.match(toCsv(rep), /2026-11-13,2,1650/);
});

test("server mode: auth, rate limit, size limit, answers", async () => {
  const agents = { ask: async (_r: string, q: string) => ({ output: `answer to ${q}`, steps: 1, toolCalls: 0, usage: { inputTokens: 1, outputTokens: 1 }, stoppedReason: "completed", routedLocal: false }) };
  const server = createPlatformServer(agents as any, { port: 0, apiKeyHashes: [hashApiKey("good-key")], rateLimitPerMinute: 2, maxBodyBytes: 200 });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (key: string | undefined, body: string, url = "/v1/agents/reader/ask") =>
    fetch(`http://127.0.0.1:${port}${url}`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    assert.equal((await call(undefined, "{}")).status, 401);
    assert.equal((await call("bad-key", "{}")).status, 401);
    const ok = await call("good-key", JSON.stringify({ question: "hi" }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).answer, "answer to hi");
    assert.equal((await call("good-key", JSON.stringify({ question: "x".repeat(500) }))).status, 413);
    assert.equal((await call("good-key", "{}")).status, 429);
  } finally {
    server.close();
  }
  const rl = new RateLimiter(1, () => 0);
  assert.equal(rl.allow("a"), true);
  assert.equal(rl.allow("a"), false);
});

test("custom deployment profiles", () => {
  assert.equal(PROFILES["air-gapped"].policy.localOnly, true);
  assert.equal(profileFromEnv({ DEPLOYMENT_PROFILE: "hybrid" }).profile, "hybrid");
  assert.throws(() => profileFromEnv({ DEPLOYMENT_PROFILE: "nope" }));
});

test("auto-update: semver compare and signed manifest verification", () => {
  assert.equal(compareVersions("1.2.10", "1.2.9"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const m: UpdateManifest = { version: "2.0.0", releasedAt: "2026-11-13", assets: { win32: { url: "https://x/a.zip", sha256: "ab" }, linux: undefined, darwin: undefined }, signature: "" };
  m.signature = sign(null, canonicalManifest(m), privateKey).toString("base64");
  const uc = new UpdateChecker("https://updates.example.com/latest.json", "1.0.0", publicKey.export({ type: "spki", format: "pem" }).toString());
  assert.equal(uc.verifyManifest(m), true);
  assert.equal(uc.verifyManifest({ ...m, assets: { ...m.assets, win32: { url: "https://evil/a.zip", sha256: "ab" } } }), false);
  assert.throws(() => new UpdateChecker("http://updates.example.com/latest.json", "1.0.0", ""), /Insecure/);
  void createHash; void http;
});
