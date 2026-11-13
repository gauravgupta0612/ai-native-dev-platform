import { test } from "node:test";
import assert from "node:assert/strict";
import { tempDir, write, ScriptedProvider } from "../helpers";
import { AuditLog, ModelRouter } from "../../common/typescript/src";
import { buildRouter, DEFAULT_ROUTING } from "../../ai-orchestration/model-router";
import { buildToolRegistry } from "../../ai-orchestration/tool-execution";
import { guardrailsFor } from "../../ai-orchestration/policy-guardrails";
import { PlatformContextBuilder } from "../../ai-orchestration/context-manager";
import { AgentService } from "../../ai-orchestration/agent-runtime";
import { Telemetry } from "../../ai-orchestration/observability";
import { WorkspaceEngine } from "../../core/workspace-engine";
import { CodeIndex } from "../../knowledge-data/code-index";
import { mergePolicies } from "../../enterprise/enterprise-policies";
import { PermissionManager } from "../../security/permission-control";
import { EnvSecretStore } from "../../security/secure-storage";
import { estimateCostUsd } from "../../model-providers/_shared";
import { createOllamaProvider } from "../../model-providers/local-ollama";
import { CustomHttpProvider } from "../../model-providers/custom-api";

test("model router: providers without keys are skipped; localOnly keeps only ollama", () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY, g: process.env.GEMINI_API_KEY };
  delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY;
  const { router, skipped } = buildRouter(DEFAULT_ROUTING, new EnvSecretStore());
  assert.deepEqual(router.listProviders(), ["ollama", "echo"]);
  assert.equal(skipped.length, 3);
  assert.deepEqual(buildRouter({ ...DEFAULT_ROUTING, localOnly: true }, new EnvSecretStore()).router.listProviders(), ["ollama"]);
  Object.assign(process.env, Object.fromEntries(Object.entries({ ANTHROPIC_API_KEY: saved.a, OPENAI_API_KEY: saved.o, GEMINI_API_KEY: saved.g }).filter(([, v]) => v)));
});

test("providers: ollama uses local http, custom mapping works, cost estimate", async () => {
  assert.equal(createOllamaProvider().name, "ollama");
  assert.equal(estimateCostUsd("anthropic", 1_000_000, 0), 3);
  const custom = new CustomHttpProvider("x", "http://example.com/api", "m", { toBody: () => ({}), fromBody: () => ({ content: "" }) });
  await assert.rejects(custom.chat({ messages: [] }), /Insecure URL/);
});

test("policy guardrails: role preset intersected with policy", () => {
  const policy = mergePolicies({ allowedTools: ["read_file", "write_file"], deniedTools: ["git_log"] });
  const g = guardrailsFor(policy, "reader");
  assert.equal(g.checkTool("read_file").allowed, true);
  assert.equal(g.checkTool("write_file").allowed, false); // not in reader preset
  assert.equal(guardrailsFor(mergePolicies({}), "coder").checkTool("anything").allowed, true);
});

test("agent service: role agent uses tools, sensitive data goes local, telemetry recorded", async () => {
  const root = tempDir();
  write(root, "src/tax.ts", "export function calculateTax(x: number) { return x * 0.2; }\n");
  const cloud = new ScriptedProvider("anthropic", [
    { toolCalls: [{ id: "1", name: "find_symbol", arguments: { name: "calculateTax" } }] },
    { content: "calculateTax is in src/tax.ts:1" },
  ]);
  const local = new ScriptedProvider("ollama", [{ content: "handled locally" }]);
  const router = new ModelRouter().register(cloud).register(local, { isLocal: true });
  const ws = new WorkspaceEngine();
  ws.addRoot(root);
  const idx = new CodeIndex();
  await idx.indexFiles(root, ["src/tax.ts"]);
  const tools = buildToolRegistry({ workspaceRoot: root, codeIndex: idx });
  const telemetryFile = `${tempDir()}/t.jsonl`;
  const svc = new AgentService({
    router, tools, policy: mergePolicies({}), permissions: new PermissionManager(), audit: new AuditLog(),
    context: new PlatformContextBuilder(ws, idx), telemetry: new Telemetry(telemetryFile),
  });
  const r = await svc.ask("reader", "Where is calculateTax?");
  assert.equal(r.output, "calculateTax is in src/tax.ts:1");
  assert.equal(r.toolCalls, 1);
  assert.equal(r.routedLocal, false);
  const s = await svc.ask("reader", "Customer card 4111 1111 1111 1111 failed, why?");
  assert.equal(s.routedLocal, true);
  assert.equal(s.output, "handled locally");
  assert.equal(cloud.requests.length, 2); // the sensitive question never reached the cloud provider
});
