"""Agent loop: ask model -> run requested tools -> feed results back -> repeat until the model answers."""
from __future__ import annotations

from dataclasses import dataclass
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
    stopped_reason: str  # "completed" | "max-steps" | "blocked"


class AgentRuntime:
    def __init__(self, router: ModelRouter, tools: Optional[ToolRegistry] = None,
                 guardrails: Optional[PolicyGuardrails] = None, audit: Optional[AuditLog] = None,
                 logger: Optional[Logger] = None, approver: Optional[Approver] = None,
                 max_steps: int = 8, name: str = "agent"):
        self.router = router
        self.tools = tools or ToolRegistry()
        self.guardrails = guardrails or PolicyGuardrails()
        self.audit = audit or AuditLog()
        self.logger = logger or Logger(name)
        self.approver = approver
        self.max_steps = max_steps
        self.name = name

    def run(self, task: str, context: Optional[ContextManager] = None,
            route_task: Optional[str] = None, sensitive: bool = False) -> AgentResult:
        context = context or ContextManager()
        usage = Usage()
        check = self.guardrails.check_input(task)
        if not check.allowed:
            self.audit.record(self.name, "input.blocked", reasons=check.reasons)
            return AgentResult(f"Request blocked: {'; '.join(check.reasons)}", 0, 0, usage, "blocked")

        safe_task = self.guardrails.redact(task)
        context.add_user(safe_task)
        self.audit.record(self.name, "run.start", task=safe_task[:200])
        tool_calls = 0
        for step in range(1, self.max_steps + 1):
            res = self.router.chat(ChatRequest(context.build(), tools=self.tools.specs() or None),
                                   task=route_task, sensitive=sensitive)
            usage.input_tokens += res.usage.input_tokens
            usage.output_tokens += res.usage.output_tokens
            context.add_assistant(res.content, res.tool_calls)
            if not res.tool_calls:
                self.audit.record(self.name, "run.complete", steps=step, provider=res.provider, model=res.model)
                return AgentResult(res.content, step, tool_calls, usage, "completed")
            for call in res.tool_calls:
                tool_calls += 1
                policy = self.guardrails.check_tool(call.name)
                result = (self.tools.execute(call, self.approver) if policy.allowed
                          else ToolResult(call.id, call.name, False, "; ".join(policy.reasons)))
                self.audit.record(self.name, "tool.call", tool=call.name, ok=result.ok)
                self.logger.debug("tool executed", tool=call.name, ok=result.ok)
                context.add_tool_result(call.id, call.name, self.guardrails.redact(result.output))
        self.audit.record(self.name, "run.max-steps", max_steps=self.max_steps)
        return AgentResult("Stopped: maximum number of steps reached.", self.max_steps, tool_calls, usage, "max-steps")
