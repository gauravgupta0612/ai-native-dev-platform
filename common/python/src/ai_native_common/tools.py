"""Tool registry: the tools agents may use, executed safely.

Arguments are validated against the JSON schema, risky tools need approval, every call has a timeout,
long outputs are cut, and errors are returned as results instead of crashing the agent.
"""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional

from .schema import validate_args
from .types import ToolCall, ToolSpec

ToolHandler = Callable[[Dict[str, Any]], Any]
Approver = Callable[[ToolCall], bool]
_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="tool")


@dataclass
class ToolDefinition:
    spec: ToolSpec
    handler: ToolHandler
    requires_approval: bool = False  # e.g. file writes, shell commands
    timeout: Optional[float] = None  # seconds; defaults to the registry timeout


@dataclass
class ToolResult:
    call_id: str
    name: str
    ok: bool
    output: str


class ToolRegistry:
    def __init__(self, timeout: float = 30.0, max_output_chars: int = 20_000):
        self.timeout = timeout
        self.max_output_chars = max_output_chars
        self._tools: Dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition) -> "ToolRegistry":
        name = definition.spec.name
        if not _NAME.match(name):
            raise ValueError(f"Invalid tool name: {name}")
        if name in self._tools:
            raise ValueError(f"Tool already registered: {name}")
        self._tools[name] = definition
        return self

    def register_all(self, definitions: Iterable[ToolDefinition]) -> "ToolRegistry":
        for d in definitions:
            self.register(d)
        return self

    def tool(self, name: str, description: str, parameters: Optional[Dict[str, Any]] = None,
             requires_approval: bool = False, timeout: Optional[float] = None):
        """Decorator: @registry.tool("name", "description", {...json schema...})."""
        def wrap(fn: ToolHandler) -> ToolHandler:
            schema = parameters or {"type": "object", "properties": {}}
            self.register(ToolDefinition(ToolSpec(name, description, schema), fn, requires_approval, timeout))
            return fn
        return wrap

    def has(self, name: str) -> bool:
        return name in self._tools

    def specs(self) -> List[ToolSpec]:
        return [t.spec for t in self._tools.values()]

    def execute(self, call: ToolCall, approver: Optional[Approver] = None) -> ToolResult:
        def fail(msg: str) -> ToolResult:
            return ToolResult(call.id, call.name, False, msg)

        definition = self._tools.get(call.name)
        if definition is None:
            return fail(f"Unknown tool: {call.name}")
        problems = validate_args(definition.spec.parameters, call.arguments or {})
        if problems:
            return fail("Invalid arguments: " + "; ".join(problems))
        if definition.requires_approval and not (approver and approver(call)):
            return fail("Denied: tool call was not approved")
        timeout = definition.timeout or self.timeout
        future = _EXECUTOR.submit(definition.handler, call.arguments or {})
        try:
            value = future.result(timeout=timeout)
        except FutureTimeout:
            future.cancel()
            return fail(f"Error: timed out after {timeout} s")
        except Exception as err:  # noqa: BLE001
            return fail(f"Error: {err}")
        output = value if isinstance(value, str) else json.dumps(value, default=str)
        if len(output) > self.max_output_chars:
            cut = len(output) - self.max_output_chars
            output = output[: self.max_output_chars] + f"\n…[truncated {cut} characters]"
        return ToolResult(call.id, call.name, True, output)
