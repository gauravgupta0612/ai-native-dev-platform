import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ai_native_common import (  # noqa: E402
    AgentRuntime, AuditLog, ChatRequest, ChatResponse, ChatMessage, ContextManager, EchoProvider, Logger,
    ModelRouter, PolicyGuardrails, RouteRule, ToolCall, ToolRegistry, Usage, create_router, load_config, load_dotenv,
)

Logger.sink = lambda line: None  # keep test output clean


class ScriptedProvider:
    """Replays a fixed list of responses (or raises errors)."""

    def __init__(self, name, script):
        self.name = name
        self.script = list(script)
        self.requests = []

    def chat(self, request):
        self.requests.append(request)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return ChatResponse(item.get("content", ""), item.get("tool_calls", []), "m", self.name, Usage(1, 1))


class CommonTests(unittest.TestCase):
    def test_echo_offline(self):
        res = EchoProvider().chat(ChatRequest([ChatMessage("user", "hi")]))
        self.assertEqual(res.content, "Echo: hi")

    def test_router_rule_and_fallback(self):
        bad = ScriptedProvider("bad", [RuntimeError("down")])
        good = ScriptedProvider("good", [{"content": "ok"}])
        router = ModelRouter().register(good).register(bad).add_rule(RouteRule("code", "bad"))
        res = router.chat(ChatRequest([ChatMessage("user", "x")]), task="code")
        self.assertEqual(res.content, "ok")
        self.assertEqual(router.metrics.snapshot()["bad"]["failures"], 1)

    def test_sensitive_goes_local(self):
        router = ModelRouter().register(EchoProvider()).register(ScriptedProvider("ollama", []), is_local=True)
        self.assertEqual(router.plan(sensitive=True), [("ollama", None)])

    def test_guardrails_redact(self):
        out = PolicyGuardrails().redact("key sk-abcdefghijklmnopqrstuv password=hunter22 a.b@example.com")
        for leaked in ("sk-abc", "hunter22", "example.com"):
            self.assertNotIn(leaked, out)

    def test_guardrails_tools_and_input(self):
        g = PolicyGuardrails(denied_tools=["shell"], blocked_patterns=[r"drop\s+table"])
        self.assertFalse(g.check_tool("shell").allowed)
        self.assertTrue(g.check_tool("read_file").allowed)
        self.assertFalse(g.check_input("please DROP TABLE users").allowed)

    def test_context_trim(self):
        ctx = ContextManager("sys", max_chars=50)
        for i in range(10):
            ctx.add_user(f"message number {i}")
        msgs = ctx.build()
        self.assertEqual(msgs[0].role, "system")
        self.assertLess(len(msgs), 11)
        self.assertEqual(msgs[-1].content, "message number 9")

    def test_agent_runs_tool(self):
        provider = ScriptedProvider("p", [
            {"tool_calls": [ToolCall("c1", "add", {"a": 2, "b": 3})]},
            {"content": "The answer is 5"},
        ])
        tools = ToolRegistry()

        @tools.tool("add", "Add numbers", {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}})
        def add(args):
            return args["a"] + args["b"]

        audit = AuditLog()
        result = AgentRuntime(ModelRouter().register(provider), tools=tools, audit=audit).run("What is 2+3?")
        self.assertEqual(result.output, "The answer is 5")
        self.assertEqual(result.tool_calls, 1)
        tool_msg = next(m for m in provider.requests[1].messages if m.role == "tool")
        self.assertEqual(tool_msg.content, "5")
        self.assertTrue(any(e.action == "tool.call" for e in audit.events()))

    def test_approval_required(self):
        tools = ToolRegistry()
        tools.tool("write", "w", requires_approval=True)(lambda args: "written")
        self.assertFalse(tools.execute(ToolCall("1", "write")).ok)
        self.assertEqual(tools.execute(ToolCall("2", "write"), approver=lambda c: True).output, "written")

    def test_create_router_without_keys(self):
        router = create_router(load_config({}))
        self.assertEqual(router.list_providers(), ["echo"])
        self.assertEqual(router.chat(ChatRequest([ChatMessage("user", "ping")])).provider, "echo")

    def test_dotenv_and_audit_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = os.path.join(tmp, ".env")
            with open(env_path, "w") as fh:
                fh.write("# comment\nOPENAI_MODEL='my-model'\n")
            env = {}
            load_dotenv(env_path, env)
            self.assertEqual(load_config(env).openai.model, "my-model")
            log_path = os.path.join(tmp, "logs", "audit.jsonl")
            AuditLog(log_path).record("tester", "test.action", ok=True)
            with open(log_path) as fh:
                self.assertIn("test.action", fh.read())


if __name__ == "__main__":
    unittest.main()
