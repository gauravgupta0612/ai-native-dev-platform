# Common Library: TypeScript · Java · Python

These are reusable building blocks for any AI-powered project. The same design is provided in three languages, with the same class names and behavior, so a team can choose whichever language fits.

| Building block | What it does | TypeScript | Java | Python |
|---|---|---|---|---|
| Model types | Provider-neutral `ChatMessage`, `ChatRequest`, `ChatResponse`, `ToolCall`, `ToolSpec` | `src/models/types.ts` | `model/*` | `types.py` |
| Model providers | OpenAI, Anthropic (Claude), Google Gemini, Ollama/local, any OpenAI-compatible API, offline Echo | `src/models/providers/*` | `provider/*` | `providers/` |
| Model router | Routes by task, sends sensitive requests to the local model, falls back automatically | `ModelRouter` | `ModelRouter` | `ModelRouter` |
| Context manager | System prompt + context snippets (files, RAG) + history, trimmed to a budget | `ContextManager` | `ContextManager` | `ContextManager` |
| Tool registry | Registers tools, enforces approval, turns errors into results | `ToolRegistry` | `ToolRegistry` | `ToolRegistry` |
| Agent runtime | Model → tools → model loop with a step limit | `AgentRuntime` | `AgentRuntime` | `AgentRuntime` |
| Policy & guardrails | Masks secrets and e-mails, blocks input patterns, tool allow/deny lists | `PolicyGuardrails` | `PolicyGuardrails` | `PolicyGuardrails` |
| Audit log | Append-only JSON-lines trail of agent and tool actions | `AuditLog` | `AuditLog` | `AuditLog` |
| Observability | JSON logger + token, latency and failure metrics per provider | `Logger`, `Metrics` | `Logger`, `Metrics` | `Logger`, `Metrics` |
| Config | Reads environment variables and `.env`; no keys in code | `loadConfig()` | `PlatformConfig.load()` | `load_config()` |

**No runtime dependencies.** TypeScript uses built-in `fetch` (Node 22+). Java uses `java.net.http` (Java 17+). Python uses only the standard library (3.9+). Without any API key, the router falls back to the offline `echo` provider, so code, tests and demos run anywhere.

## Quick start

```bash
# TypeScript
cd common/typescript && npm install && npm test && npm run example

# Python
cd common/python && python -m unittest discover -s tests && python examples/basic_agent.py

# Java (Maven)
cd common/java && mvn test && mvn -q compile exec:java
```

## Configuration (`.env`, never commit it)

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | OpenAI |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic (Claude) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Google Gemini |
| `OLLAMA_ENABLED=true`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Local models (used for `sensitive` requests) |
| `CUSTOM_API_URL`, `CUSTOM_API_KEY`, `CUSTOM_MODEL` | Any OpenAI-compatible endpoint |
| `DEFAULT_PROVIDER` | `auto` (first available) or a provider name |
| `AUDIT_LOG_PATH` | e.g. `logs/audit.jsonl` |
| `MAX_AGENT_STEPS` | Agent loop limit (default 8) |
| `LOG_LEVEL` | `debug`, `info`, `warn` or `error` |

Default model names can change over time. Set the `*_MODEL` variables to the models you use.

## Typical usage (same in all three languages)

```text
config  = load config from env/.env
router  = createRouter(config)            # registers every provider that has a key + echo
router.addRule("code-generation" → "anthropic")
tools   = ToolRegistry + your tools (read_file, run_tests, search_code…)
agent   = AgentRuntime(router, tools, guardrails, auditLog)
result  = agent.run("Explain this function", context, {task: "code-generation"})
```

## Adding a new provider

Implement the single `ModelProvider` interface (`name` + `chat(request)`), then call `router.register(new MyProvider())`.
