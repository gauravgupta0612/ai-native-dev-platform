"""Agent loop: ask model -> run requested tools -> feed results back -> repeat until the model answers.

Security: input checks, secret masking before every send, tool policy + approval, prompt-injection flagging
of tool output, step/tool/token budgets and a hash-chained audit trail.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Optional

from .audit import AuditLog
from .context import ContextManager
from .guardrails import PolicyGuardrails
from .observability import Logger
from .router import ModelRouter
from .tools import Approver, ToolRegistry, ToolResult
from .types import ChatRequest, Usage


@dataclass
class AgentResult:
    output: str
    steps: int
    tool_calls: int
    usage: Usage
    stopped_reason: str  # "completed" | "max-steps" | "blocked" | "budget" | "max-tool-calls"


class AgentRuntime:
    def __init__(self, router: ModelRouter, tools: Optional[ToolRegistry] = None,
                 guardrails: Optional[PolicyGuardrails] = None, audit: Optional[AuditLog] = None,
                 logger: Optional[Logger] = None, approver: Optional[Approver] = None,
                 max_steps: int = 8, max_total_tokens: Optional[int] = None, max_tool_calls: int = 25,
                 name: str = "agent"):
        self.router = router
        self.tools = tools or ToolRegistry()
        self.guardrails = guardrails or PolicyGuardrails()
        self.audit = audit or AuditLog()
        self.logger = logger or Logger(name)
        self.approver = approver
        self.max_steps = max_steps
        self.max_total_tokens = max_total_tokens
        self.max_tool_calls = max_tool_calls
        self.name = name

    def run(self, task: str, context: Optional[ContextManager] = None,
            route_task: Optional[str] = None, sensitive: bool = False) -> AgentResult:
        context = context or ContextManager()
        usage = Usage()

        def finish(output: str, steps: int, calls: int, reason: str) -> AgentResult:
            self.audit.record(self.name, f"run.{reason}", steps=steps, tool_calls=calls,
                              input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)
            return AgentResult(output, steps, calls, usage, reason)

        check = self.guardrails.check_input(task)
        if not check.allowed:
            self.audit.record(self.name, "input.blocked", reasons=check.reasons)
            return AgentResult(f"Request blocked: {'; '.join(check.reasons)}", 0, 0, usage, "blocked")

        safe_task = self.guardrails.redact(task)
        context.add_user(safe_task)
        self.audit.record(self.name, "run.start", task=safe_task[:200], sensitive=sensitive)
        tool_calls = 0
        for step in range(1, self.max_steps + 1):
            messages = [replace(m, content=self.guardrails.redact(m.content)) for m in context.build()]
            res = self.router.chat(ChatRequest(messages, tools=self.tools.specs() or None),
                                   task=route_task, sensitive=sensitive)
            usage.input_tokens += res.usage.input_tokens
            usage.output_tokens += res.usage.output_tokens
            context.add_assistant(res.content, res.tool_calls)
            if not res.tool_calls:
                return finish(res.content, step, tool_calls, "completed")

            for call in res.tool_calls:
                if tool_calls >= self.max_tool_calls:
                    context.add_tool_result(call.id, call.name, "Skipped: tool call limit reached")
                    continue
                tool_calls += 1
                policy = self.guardrails.check_tool(call.name)
                result = (self.tools.execute(call, self.approver) if policy.allowed
                          else ToolResult(call.id, call.name, False, "; ".join(policy.reasons)))
                text, suspicious = self.guardrails.wrap_untrusted(f"tool {call.name}", self.guardrails.redact(result.output))
                self.audit.record(self.name, "tool.call", tool=call.name, ok=result.ok, injection_suspected=bool(suspicious))
                if suspicious:
                    self.logger.warn("possible prompt injection in tool output", tool=call.name)
                context.add_tool_result(call.id, call.name, text)

            if self.max_total_tokens is not None and usage.input_tokens + usage.output_tokens >= self.max_total_tokens:
                return finish("Stopped: token budget reached.", step, tool_calls, "budget")
            if tool_calls >= self.max_tool_calls:
                return finish("Stopped: tool call limit reached.", step, tool_calls, "max-tool-calls")
        return finish("Stopped: maximum number of steps reached.", self.max_steps, tool_calls, "max-steps")
