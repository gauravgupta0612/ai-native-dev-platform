# @gauravgupta0612/ai-native-common for TypeScript

Requires **Node 22+**. There are no runtime dependencies; TypeScript and `@types/node` are needed only to build.

## 1. Add it to your project

```bash
npm install @gauravgupta0612/ai-native-common
```

Other options: install a local build with `npm install /path/to/common/typescript`, or copy `src/` into your project.

To work on the library itself:

```bash
npm install && npm test     # builds and runs the 19 offline tests
npm run example             # runs examples/basic-agent.ts
```

## 2. Configure keys (`.env` in your project root, never commit it)

```env
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
OLLAMA_ENABLED=true            # optional: local model for sensitive data
AUDIT_LOG_PATH=logs/audit.jsonl
```

```ts
import { loadDotEnv, loadConfig, redactConfig, createRouter } from "@gauravgupta0612/ai-native-common";

loadDotEnv();                                   // reads .env (real env vars win)
const config = loadConfig();
console.log(redactConfig(config));              // safe to print: keys shown as "xxxx"
const router = createRouter(config);            // registers every provider that has a key, plus "echo"
```

## 3. Simple chat

```ts
const res = await router.chat({
  messages: [
    { role: "system", content: "You are a concise assistant." },
    { role: "user", content: "Explain RPG free format in 2 lines." },
  ],
  temperature: 0.2,
  maxTokens: 300,
});
console.log(res.content, res.provider, res.usage);
```

## 4. Routing, retries and fallback

```ts
router.addRule({ task: "code-generation", provider: "anthropic" });
router.addRule({ task: "summarize", provider: "openai", model: "gpt-4o-mini" });
router.setFallbackOrder(["anthropic", "openai", "echo"]);

await router.chat(request, { task: "code-generation" }); // 429/5xx are retried, then the next provider is tried
await router.chat(request, { sensitive: true });          // only the local Ollama model; fails if none is registered
console.log(router.metrics.snapshot());                   // calls, failures, tokens, latency per provider
```

You can set the retry policy yourself: `new ModelRouter(logger, metrics, { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 8000 })`.

## 5. An agent with your own tools

```ts
import { AgentRuntime, ToolRegistry, PolicyGuardrails, AuditLog } from "@gauravgupta0612/ai-native-common";

const tools = new ToolRegistry({ timeoutMs: 15_000, maxOutputChars: 20_000 }).register({
  spec: {
    name: "get_ticket",
    description: "Fetch a Jira ticket by key",
    parameters: {
      type: "object",
      properties: { key: { type: "string", minLength: 3, maxLength: 20 } },
      required: ["key"],
      additionalProperties: false,          // arguments are validated before your handler runs
    },
  },
  handler: async ({ key }) => ({ key, status: "In Progress" }),
});

const agent = new AgentRuntime({
  name: "support-agent",
  router,
  tools,
  guardrails: new PolicyGuardrails({ allowedTools: ["get_ticket"], blockedPatterns: [/drop\s+table/i] }),
  audit: new AuditLog(config.auditLogPath),
  maxSteps: 8,
  maxToolCalls: 20,
  maxTotalTokens: 50_000,
});

const result = await agent.run("What is the status of TMS-123?", undefined, { task: "code-generation" });
console.log(result.output, result.stoppedReason); // completed | max-steps | budget | max-tool-calls | blocked
```

## 6. Safe file access (workspace tools + approval)

```ts
import { createWorkspaceTools } from "@gauravgupta0612/ai-native-common";

const tools = new ToolRegistry().registerAll(
  createWorkspaceTools("/path/to/repo", { allowWrite: true }), // read_file, list_files, search_text, write_file
);

const agent = new AgentRuntime({
  router,
  tools,
  approver: async (call) => askUserInYourUi(`Allow ${call.name} on ${call.arguments.path}?`), // write_file needs this
});
```

The agent cannot leave `/path/to/repo` (`../`, absolute paths and symlinks are blocked). It also cannot see `.env`, key files, `.git` or `node_modules`.

## 7. Add context (open files, RAG results)

```ts
import { ContextManager } from "@gauravgupta0612/ai-native-common";

const ctx = new ContextManager("You are an IBM i expert.", 48_000);
ctx.addSnippet({ source: "src/ORDERS.rpgle", text: fileText });
await agent.run("Find the bug in this program", ctx);
```

## 8. Audit and verify

```ts
const ok = AuditLog.verifyFile("logs/audit.jsonl"); // -1 = intact, otherwise the first altered line
```

## 9. Add your own provider

```ts
import { ModelProvider, ChatRequest, ChatResponse } from "@gauravgupta0612/ai-native-common";

class MyGatewayProvider implements ModelProvider {
  readonly name = "my-gateway";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    // call your API, then return { content, toolCalls: [], model, provider: this.name, usage }
  }
}
router.register(new MyGatewayProvider(), { isDefault: true });
```

Any OpenAI-compatible endpoint needs no new code: `new OpenAICompatibleProvider({ name: "azure", baseUrl, apiKey, defaultModel })`.

## 10. Unit-test your code without a network

Use `EchoProvider`, or write a small scripted provider that returns fixed `ChatResponse` objects (see `test/common.test.ts`).

---

**Folders:** `src/models` (types, providers, router, factory) · `src/orchestration` (context, tools, schema validator, agent) · `src/tools` (workspace tools) · `src/security` (guardrails, audit) · `src/observability` (logger, metrics) · `src/config`.
