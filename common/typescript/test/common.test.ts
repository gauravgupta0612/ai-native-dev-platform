import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AgentRuntime, AuditLog, ChatRequest, ChatResponse, ContextManager, EchoProvider, ModelProvider,
  ModelRouter, PolicyGuardrails, ToolRegistry, createRouter, loadConfig, Logger,
} from "../src";

Logger.sink = () => {}; // keep test output clean

/** Provider that replays a fixed list of responses. */
class ScriptedProvider implements ModelProvider {
  readonly requests: ChatRequest[] = [];
  constructor(readonly name: string, private readonly script: Array<Partial<ChatResponse> | Error>) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return { content: "", toolCalls: [], model: "m", provider: this.name, usage: { inputTokens: 1, outputTokens: 1 }, ...next };
  }
}

test("echo provider works offline", async () => {
  const res = await new EchoProvider().chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.content, "Echo: hi");
});

test("router uses task rule, then falls back on failure", async () => {
  const bad = new ScriptedProvider("bad", [new Error("down")]);
  const good = new ScriptedProvider("good", [{ content: "ok" }]);
  const router = new ModelRouter().register(good).register(bad).addRule({ task: "code", provider: "bad" });
  const res = await router.chat({ messages: [{ role: "user", content: "x" }] }, { task: "code" });
  assert.equal(res.content, "ok");
  assert.equal(router.metrics.snapshot().bad.failures, 1);
});

test("sensitive requests go only to the local provider", () => {
  const router = new ModelRouter().register(new EchoProvider()).register(new ScriptedProvider("ollama", []), { isLocal: true });
  assert.deepEqual(router.plan({ sensitive: true }), [{ provider: "ollama" }]);
});

test("guardrails mask secrets and e-mails", () => {
  const g = new PolicyGuardrails();
  const out = g.redact("key sk-abcdefghijklmnopqrstuv and password=hunter22 mail a.b@example.com");
  assert.ok(!out.includes("sk-abc") && !out.includes("hunter22") && !out.includes("example.com"), out);
});

test("guardrails tool policy", () => {
  const g = new PolicyGuardrails({ deniedTools: ["shell"] });
  assert.equal(g.checkTool("shell").allowed, false);
  assert.equal(g.checkTool("read_file").allowed, true);
});

test("context manager trims old turns but keeps system prompt", () => {
  const ctx = new ContextManager("sys", 50);
  for (let i = 0; i < 10; i++) ctx.addUser(`message number ${i}`);
  const msgs = ctx.build();
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs.length < 11);
  assert.equal(msgs[msgs.length - 1].content, "message number 9");
});

test("agent runs a tool and returns the final answer", async () => {
  const provider = new ScriptedProvider("p", [
    { toolCalls: [{ id: "c1", name: "add", arguments: { a: 2, b: 3 } }] },
    { content: "The answer is 5" },
  ]);
  const tools = new ToolRegistry().register({
    spec: { name: "add", description: "Add numbers", parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
    handler: ({ a, b }) => Number(a) + Number(b),
  });
  const audit = new AuditLog();
  const agent = new AgentRuntime({ router: new ModelRouter().register(provider), tools, audit });
  const result = await agent.run("What is 2+3?");
  assert.equal(result.output, "The answer is 5");
  assert.equal(result.toolCalls, 1);
  const toolMsg = provider.requests[1].messages.find((m) => m.role === "tool");
  assert.equal(toolMsg?.content, "5");
  assert.ok(audit.events().some((e) => e.action === "tool.call"));
});

test("tools needing approval are denied without an approver", async () => {
  const tools = new ToolRegistry().register({
    spec: { name: "write", description: "w", parameters: { type: "object" } },
    handler: () => "written",
    requiresApproval: true,
  });
  const r = await tools.execute({ id: "1", name: "write", arguments: {} });
  assert.equal(r.ok, false);
  const r2 = await tools.execute({ id: "2", name: "write", arguments: {} }, () => true);
  assert.equal(r2.output, "written");
});

test("createRouter without keys falls back to echo", async () => {
  const router = createRouter(loadConfig({}));
  assert.deepEqual(router.listProviders(), ["echo"]);
  const res = await router.chat({ messages: [{ role: "user", content: "ping" }] });
  assert.equal(res.provider, "echo");
});
