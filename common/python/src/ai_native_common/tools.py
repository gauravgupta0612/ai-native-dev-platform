"""Tool registry: the tools agents may use, executed safely (errors become results, not crashes)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from .types import ToolCall, ToolSpec

ToolHandler = Callable[[Dict[str, Any]], Any]
Approver = Callable[[ToolCall], bool]


@dataclass
class ToolDefinition:
    spec: ToolSpec
    handler: ToolHandler
    requires_approval: bool = False  # e.g. file writes, shell commands


@dataclass
class ToolResult:
    call_id: str
    name: str
    ok: bool
    output: str


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition) -> "ToolRegistry":
        if definition.spec.name in self._tools:
            raise ValueError(f"Tool already registered: {definition.spec.name}")
        self._tools[definition.spec.name] = definition
        return self

    def tool(self, name: str, description: str, parameters: Optional[Dict[str, Any]] = None, requires_approval: bool = False):
        """Decorator: @registry.tool("name", "description", {...json schema...})."""
        def wrap(fn: ToolHandler) -> ToolHandler:
            self.register(ToolDefinition(ToolSpec(name, description, parameters or {"type": "object", "properties": {}}),
                                         fn, requires_approval))
            return fn
        return wrap

    def has(self, name: str) -> bool:
        return name in self._tools

    def specs(self) -> List[ToolSpec]:
        return [t.spec for t in self._tools.values()]

    def execute(self, call: ToolCall, approver: Optional[Approver] = None) -> ToolResult:
        definition = self._tools.get(call.name)
        if definition is None:
            return ToolResult(call.id, call.name, False, f"Unknown tool: {call.name}")
        if definition.requires_approval and not (approver and approver(call)):
            return ToolResult(call.id, call.name, False, "Denied: tool call was not approved")
        try:
            value = definition.handler(call.arguments or {})
            output = value if isinstance(value, str) else json.dumps(value, default=str)
            return ToolResult(call.id, call.name, True, output)
        except Exception as err:  # noqa: BLE001
            return ToolResult(call.id, call.name, False, f"Error: {err}")
