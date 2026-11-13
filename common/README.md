# AI-Native Common Library: TypeScript · Java · Python

These are secure, reusable building blocks for any project that talks to AI models. The same design is provided in **TypeScript, Java and Python**, with the same class names and behavior, so each team can use the language it already works in.

- **No runtime dependencies.** TypeScript needs Node 22+ (built-in `fetch`). Java needs Java 17+ (`java.net.http` and its own small JSON helper). Python needs 3.9+ and uses only the standard library.
- **Works offline.** Without API keys the router uses the built-in `echo` provider, so your app, tests and CI run anywhere.
- **Secure by default.** HTTPS only, secret masking everywhere, sandboxed file tools, tool approval, prompt-injection flagging and a tamper-evident audit log. See [SECURITY.md](SECURITY.md).

| Language | Guide | Package |
|---|---|---|
| TypeScript | [typescript/README.md](typescript/README.md) | `@ai-native/common` |
| Python | [python/README.md](python/README.md) | `ai-native-common` (import `ai_native_common`) |
| Java | [java/README.md](java/README.md) | `com.ainative:ai-native-common` |

---

## What's inside

| Building block | What it does |
|---|---|
| **Model providers** | OpenAI, Anthropic (Claude), Google Gemini, Ollama/local, any OpenAI-compatible API, plus the offline Echo provider. All share one `ModelProvider` interface. |
| **Model router** | Chooses a provider per task, sends `sensitive` requests only to the local model, **retries** 429/5xx/network errors with backoff, then **falls back** to the next provider. |
| **Context manager** | System prompt, context snippets (open files, RAG hits) and chat history, trimmed to a size budget. |
| **Tool registry** | Your functions as AI tools, with **JSON-schema argument validation**, **approval** for risky tools, **timeouts** and **output size limits**. |
| **Workspace tools** | Ready-made `read_file`, `list_files`, `search_text` and `write_file` (write needs approval), **locked to one folder**, with `.env`, keys and `.git` hidden. |
| **Agent runtime** | Model → tools → model loop, with **step, tool-call and token budgets**. |
| **Guardrails** | Masks API keys, tokens, JWTs, private keys and passwords (and e-mails by default) before anything is sent; blocks forbidden input; tool allow/deny lists; prompt-injection detection. |
| **Audit log** | Append-only JSON lines, **hash-chained**, so any edit to a past line is detected by `verifyFile`. Secrets are masked. |
| **Observability** | JSON logger with automatic secret redaction, plus per-provider metrics (calls, failures, tokens, latency). |
| **Config** | Environment variables and `.env`. Keys are never printed (`redactConfig`, `safe_dict()`, `toString()`). |

## How a request flows

```text
your app ──► AgentRuntime ──► Guardrails (check input, mask secrets)
                 │
                 ├──► ModelRouter ──► rule / default / fallback ──► Provider (HTTPS only, retry on 429/5xx)
                 │
                 ├──► ToolRegistry ──► validate args ──► approval? ──► run with timeout ──► cap output
                 │                                                                   │
                 │                         Guardrails.wrapUntrusted (prompt-injection flag) ◄─┘
                 │
                 └──► AuditLog (hash-chained) + Logger (redacted) + Metrics
```

## Configuration (`.env`, never commit it)

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | OpenAI | `gpt-4o-mini` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL` | Anthropic (Claude) | `claude-sonnet-4-5` |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_BASE_URL` | Google Gemini (text chat only) | `gemini-2.5-flash` |
| `OLLAMA_ENABLED=true`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Local models (used for `sensitive` requests) | `http://localhost:11434`, `llama3.1` |
| `CUSTOM_API_URL`, `CUSTOM_API_KEY`, `CUSTOM_MODEL` | Any OpenAI-compatible endpoint (must be https) | none |
| `DEFAULT_PROVIDER` | `auto` (first available) or a provider name | `auto` |
| `MAX_RETRIES` | Retries per provider for 429/5xx/network errors | `2` |
| `MAX_AGENT_STEPS` | Agent loop limit | `8` |
| `AUDIT_LOG_PATH` | e.g. `logs/audit.jsonl` (no file if empty) | none |
| `LOG_LEVEL` | `debug`, `info`, `warn` or `error` | `info` |

Default model names change over time. Set the `*_MODEL` variables to the models your account uses.

## Use it in your own project

| Language | Option A: copy the source | Option B: install as a package |
|---|---|---|
| TypeScript | Copy `typescript/src` into your project | `npm install ../path/to/common/typescript` |
| Python | Copy `python/src/ai_native_common` | `pip install -e path/to/common/python` |
| Java | Copy `java/src/main/java/com/ainative` | `mvn install` here, then add the dependency (see the Java guide) |

## Run the tests

```bash
cd typescript && npm install && npm test             # 19 tests
cd python && python -m unittest discover -s tests    # 20 tests
cd java && mvn test                                  # 21 tests
```

## Extend it

- **New model:** implement `ModelProvider` (`name` + `chat(request)`), then call `router.register(...)`.
- **New tool:** register a `ToolSpec` (name, description, JSON schema) plus a handler. Set `requiresApproval` for anything that writes, deletes, runs commands or sends data out.
- **Stricter policy:** use `PolicyGuardrails` with `allowedTools`, `blockedPatterns` and extra secret patterns for your company's token formats.
