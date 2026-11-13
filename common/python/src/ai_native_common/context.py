"""Context manager: system prompt + extra context (open files, RAG results) + conversation, trimmed to a budget."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import List, Optional

from .types import ChatMessage, ToolCall


@dataclass
class ContextSnippet:
    source: str  # file path, RAG hit id, doc URL...
    text: str


class ContextManager:
    def __init__(self, system_prompt: str = "You are a helpful software engineering assistant.", max_chars: int = 48_000):
        self.system_prompt = system_prompt
        self.max_chars = max_chars
        self._history: List[ChatMessage] = []
        self._snippets: List[ContextSnippet] = []

    def add_snippet(self, source: str, text: str) -> None:
        self._snippets.append(ContextSnippet(source, text))

    def clear_snippets(self) -> None:
        self._snippets.clear()

    def add(self, message: ChatMessage) -> None:
        self._history.append(message)

    def add_user(self, content: str) -> None:
        self.add(ChatMessage("user", content))

    def add_assistant(self, content: str, tool_calls: Optional[List[ToolCall]] = None) -> None:
        self.add(ChatMessage("assistant", content, tool_calls=tool_calls or None))

    def add_tool_result(self, tool_call_id: str, name: str, content: str) -> None:
        self.add(ChatMessage("tool", content, tool_call_id=tool_call_id, name=name))

    @property
    def history(self) -> List[ChatMessage]:
        return list(self._history)

    def build(self) -> List[ChatMessage]:
        system = self.system_prompt
        if self._snippets:
            system += "\n\n# Context\n" + "\n\n".join(f"## {s.source}\n{s.text}" for s in self._snippets)
        budget = max(0, self.max_chars - len(system))
        kept: List[ChatMessage] = []
        used = 0
        for m in reversed(self._history):
            used += len(m.content) + len(json.dumps([c.__dict__ for c in (m.tool_calls or [])]))
            if used > budget and kept:
                break
            kept.insert(0, m)
        while kept and kept[0].role == "tool":  # never start with an orphan tool result
            kept.pop(0)
        return [ChatMessage("system", system), *kept]
