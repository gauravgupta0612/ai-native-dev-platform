# @ai-native/common (TypeScript)

Requires Node 22+. It has no runtime dependencies (it uses the built-in `fetch`).

```bash
npm install      # dev tools only (typescript, @types/node)
npm test         # builds and runs tests (offline)
npm run example  # runs examples/basic-agent.ts
```

```ts
import { AgentRuntime, ToolRegistry, PolicyGuardrails, AuditLog, createRouter, loadConfig, loadDotEnv } from "@ai-native/common";

loadDotEnv();
const router = createRouter(loadConfig());
router.addRule({ task: "code-generation", provider: "anthropic" });

const tools = new ToolRegistry().register({
  spec: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
  handler: ({ path }) => require("fs").readFileSync(String(path), "utf8"),
});

const agent = new AgentRuntime({ router, tools, guardrails: new PolicyGuardrails({ deniedTools: ["shell"] }), audit: new AuditLog("logs/audit.jsonl") });
const result = await agent.run("Summarize README.md", undefined, { task: "code-generation" });
```

Folders: `src/models` (types, providers, router), `src/orchestration` (context, tools, agent), `src/security` (guardrails, audit), `src/observability`, `src/config`.
