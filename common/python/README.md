# ai-native-common (Python)

Requires Python 3.9+ and uses only the standard library.

```bash
pip install -e .                                   # optional: install as a package
python -m unittest discover -s tests               # run tests (offline)
python examples/basic_agent.py                     # demo
```

```python
from ai_native_common import AgentRuntime, ToolRegistry, PolicyGuardrails, AuditLog, RouteRule, create_router, load_config, load_dotenv

load_dotenv()
router = create_router(load_config())
router.add_rule(RouteRule("code-generation", "anthropic"))

tools = ToolRegistry()

@tools.tool("read_file", "Read a file", {"type": "object", "properties": {"path": {"type": "string"}}})
def read_file(args):
    return open(args["path"], encoding="utf-8").read()

agent = AgentRuntime(router, tools=tools, guardrails=PolicyGuardrails(denied_tools=["shell"]), audit=AuditLog("logs/audit.jsonl"))
result = agent.run("Summarize README.md", route_task="code-generation")
print(result.output)
```

Modules: `types`, `providers`, `router`, `factory`, `config`, `context`, `tools`, `agent`, `guardrails`, `audit`, `observability`.
