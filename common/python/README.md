# ai-native-common for Python

Requires **Python 3.10+** and uses only the standard library.

## 1. Add it to your project

```bash
pip install "git+https://github.com/gauravgupta0612/ai-native-dev-platform.git@v0.2.0#subdirectory=common/python"
```

In `requirements.txt`:

```text
ai-native-common @ git+https://github.com/gauravgupta0612/ai-native-dev-platform.git@v0.2.0#subdirectory=common/python
```

Other options: `pip install -e /path/to/common/python` for a local editable install, or copy `src/ai_native_common` into your project.

To work on the library itself:

```bash
python -m unittest discover -s tests     # 20 offline tests
python examples/basic_agent.py           # demo
```

## 2. Configure keys (`.env` in your project root, never commit it)

```env
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
OLLAMA_ENABLED=true            # optional: local model for sensitive data
AUDIT_LOG_PATH=logs/audit.jsonl
```

```python
from ai_native_common import load_dotenv, load_config, create_router

load_dotenv()                       # reads .env (real env vars win)
config = load_config()
print(config)                       # safe: api_key is hidden from repr
print(config.safe_dict())           # dict with keys shown as "xxxx"
router = create_router(config)      # every provider that has a key, plus "echo"
```

## 3. Simple chat

```python
from ai_native_common import ChatRequest, ChatMessage

res = router.chat(ChatRequest(
    [ChatMessage("system", "You are a concise assistant."),
     ChatMessage("user", "Explain RPG free format in 2 lines.")],
    temperature=0.2, max_tokens=300))
print(res.content, res.provider, res.usage)
```

## 4. Routing, retries and fallback

```python
from ai_native_common import RouteRule, ModelRouter, RetryPolicy

router.add_rule(RouteRule("code-generation", "anthropic"))
router.add_rule(RouteRule("summarize", "openai", model="gpt-4o-mini"))
router.set_fallback_order(["anthropic", "openai", "echo"])

router.chat(request, task="code-generation")   # 429/5xx are retried, then the next provider is tried
router.chat(request, sensitive=True)           # only the local Ollama model; fails if none is registered
print(router.metrics.snapshot())
```

You can set the retry policy yourself: `ModelRouter(retry=RetryPolicy(max_retries=3, base_delay=0.5, max_delay=8))`.

## 5. An agent with your own tools

```python
from ai_native_common import AgentRuntime, ToolRegistry, PolicyGuardrails, AuditLog

tools = ToolRegistry(timeout=15, max_output_chars=20_000)

@tools.tool("get_ticket", "Fetch a Jira ticket by key", {
    "type": "object",
    "properties": {"key": {"type": "string", "minLength": 3, "maxLength": 20}},
    "required": ["key"],
    "additionalProperties": False,          # arguments are validated before your function runs
})
def get_ticket(args):
    return {"key": args["key"], "status": "In Progress"}

agent = AgentRuntime(
    router,
    tools=tools,
    guardrails=PolicyGuardrails(allowed_tools=["get_ticket"], blocked_patterns=[r"drop\s+table"]),
    audit=AuditLog(config.audit_log_path),
    max_steps=8, max_tool_calls=20, max_total_tokens=50_000,
    name="support-agent",
)
result = agent.run("What is the status of TMS-123?", route_task="code-generation")
print(result.output, result.stopped_reason)   # completed | max-steps | budget | max-tool-calls | blocked
```

## 6. Safe file access (workspace tools + approval)

```python
from ai_native_common import create_workspace_tools

tools = ToolRegistry().register_all(create_workspace_tools("/path/to/repo", allow_write=True))

def approve(call):                      # write_file only runs if this returns True
    return input(f"Allow {call.name} on {call.arguments.get('path')}? [y/N] ").lower() == "y"

agent = AgentRuntime(router, tools=tools, approver=approve)
```

The agent cannot leave `/path/to/repo` (`../`, absolute paths and symlinks are blocked). It also cannot see `.env`, key files, `.git`, `.venv` or `__pycache__`.

## 7. Add context (open files, RAG results)

```python
from ai_native_common import ContextManager

ctx = ContextManager("You are an IBM i expert.", max_chars=48_000)
ctx.add_snippet("src/ORDERS.rpgle", file_text)
agent.run("Find the bug in this program", context=ctx)
```

## 8. Audit and verify

```python
AuditLog.verify_file("logs/audit.jsonl")   # -1 = intact, otherwise the first altered line
```

## 9. Add your own provider

```python
from ai_native_common import ChatResponse, Usage

class MyGatewayProvider:
    name = "my-gateway"
    def chat(self, request):
        # call your API ...
        return ChatResponse("answer", [], "my-model", self.name, Usage(10, 5))

router.register(MyGatewayProvider(), is_default=True)
```

Any OpenAI-compatible endpoint needs no new code: `OpenAICompatibleProvider("azure", base_url, model, api_key)`.

## 10. Unit-test your code without a network

Use `EchoProvider`, or a scripted fake provider (see `tests/test_common.py`).

---

**Modules:** `types` · `providers` · `router` · `factory` · `config` · `context` · `tools` · `schema` · `workspace_tools` · `agent` · `guardrails` · `audit` · `observability`.
