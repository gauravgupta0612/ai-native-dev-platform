"""Shared, provider-neutral types used by every module."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ChatMessage:
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str
    tool_calls: Optional[List[ToolCall]] = None  # assistant asking to run tools
    tool_call_id: Optional[str] = None  # tool result: which call it answers
    name: Optional[str] = None  # tool name for tool results


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema of the arguments object


@dataclass
class ChatRequest:
    messages: List[ChatMessage]
    model: Optional[str] = None
    tools: Optional[List[ToolSpec]] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class ChatResponse:
    content: str
    tool_calls: List[ToolCall]
    model: str
    provider: str
    usage: Usage


class ModelProvider(Protocol):
    """Every AI model adapter implements this one interface."""

    name: str

    def chat(self, request: ChatRequest) -> ChatResponse: ...


class ProviderError(Exception):
    def __init__(self, provider: str, message: str, status: Optional[int] = None):
        super().__init__(f"[{provider}] {message}")
        self.provider = provider
        self.status = status

    @property
    def retryable(self) -> bool:
        """Network errors, timeouts, 408, 429 and 5xx are worth retrying; other 4xx (bad key, bad request) are not."""
        return self.status is None or self.status in (408, 429) or self.status >= 500
