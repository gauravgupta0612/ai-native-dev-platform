"""Model provider adapters."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..types import ChatRequest, ChatResponse, ToolCall, Usage
from .http import post_json, safe_parse_args

__all__ = ["OpenAICompatibleProvider", "AnthropicProvider", "GeminiProvider", "EchoProvider"]


class OpenAICompatibleProvider:
    """OpenAI and any OpenAI-compatible endpoint: Ollama (http://localhost:11434/v1), LM Studio, vLLM, in-house APIs."""

    def __init__(self, name: str, base_url: str, default_model: str, api_key: Optional[str] = None, timeout: float = 60.0):
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model
        self.api_key = api_key
        self.timeout = timeout

    def chat(self, request: ChatRequest) -> ChatResponse:
        model = request.model or self.default_model
        messages: List[Dict[str, Any]] = []
        for m in request.messages:
            if m.role == "tool":
                messages.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content})
            elif m.role == "assistant" and m.tool_calls:
                messages.append({
                    "role": "assistant",
                    "content": m.content or None,
                    "tool_calls": [
                        {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": json.dumps(c.arguments)}}
                        for c in m.tool_calls
                    ],
                })
            else:
                messages.append({"role": m.role, "content": m.content})
        body: Dict[str, Any] = {"model": model, "messages": messages}
        if request.temperature is not None:
            body["temperature"] = request.temperature
        if request.max_tokens is not None:
            body["max_tokens"] = request.max_tokens
        if request.tools:
            body["tools"] = [
                {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
                for t in request.tools
            ]
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        data = post_json(self.name, f"{self.base_url}/chat/completions", body, headers, self.timeout)
        msg = ((data.get("choices") or [{}])[0]).get("message") or {}
        usage = data.get("usage") or {}
        return ChatResponse(
            content=msg.get("content") or "",
            tool_calls=[
                ToolCall(id=c.get("id", ""), name=(c.get("function") or {}).get("name", ""),
                         arguments=safe_parse_args((c.get("function") or {}).get("arguments")))
                for c in (msg.get("tool_calls") or [])
            ],
            model=data.get("model", model),
            provider=self.name,
            usage=Usage(usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)),
        )


class AnthropicProvider:
    """Anthropic (Claude) Messages API adapter, with tool use."""

    name = "anthropic"

    def __init__(self, api_key: str, default_model: str, base_url: str = "https://api.anthropic.com", timeout: float = 60.0):
        self.api_key = api_key
        self.default_model = default_model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def chat(self, request: ChatRequest) -> ChatResponse:
        model = request.model or self.default_model
        system = "\n\n".join(m.content for m in request.messages if m.role == "system")
        messages: List[Dict[str, Any]] = []
        for m in request.messages:
            if m.role == "system":
                continue
            if m.role == "tool":
                messages.append({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": m.tool_call_id, "content": m.content}]})
            elif m.role == "assistant" and m.tool_calls:
                blocks: List[Dict[str, Any]] = [{"type": "text", "text": m.content}] if m.content else []
                blocks += [{"type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments} for c in m.tool_calls]
                messages.append({"role": "assistant", "content": blocks})
            else:
                messages.append({"role": m.role, "content": m.content})
        body: Dict[str, Any] = {"model": model, "max_tokens": request.max_tokens or 4096, "messages": messages}
        if system:
            body["system"] = system
        if request.temperature is not None:
            body["temperature"] = request.temperature
        if request.tools:
            body["tools"] = [{"name": t.name, "description": t.description, "input_schema": t.parameters} for t in request.tools]
        headers = {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"}
        data = post_json(self.name, f"{self.base_url}/v1/messages", body, headers, self.timeout)
        blocks = data.get("content") or []
        usage = data.get("usage") or {}
        return ChatResponse(
            content="".join(b.get("text", "") for b in blocks if b.get("type") == "text"),
            tool_calls=[ToolCall(b["id"], b["name"], b.get("input") or {}) for b in blocks if b.get("type") == "tool_use"],
            model=data.get("model", model),
            provider=self.name,
            usage=Usage(usage.get("input_tokens", 0), usage.get("output_tokens", 0)),
        )


class GeminiProvider:
    """Google Gemini generateContent adapter (text chat). Use OpenAI/Anthropic for native tool calling."""

    name = "gemini"

    def __init__(self, api_key: str, default_model: str,
                 base_url: str = "https://generativelanguage.googleapis.com/v1beta", timeout: float = 60.0):
        self.api_key = api_key
        self.default_model = default_model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def chat(self, request: ChatRequest) -> ChatResponse:
        model = request.model or self.default_model
        system = "\n\n".join(m.content for m in request.messages if m.role == "system")
        contents = []
        for m in request.messages:
            if m.role == "system":
                continue
            text = f"Tool result ({m.name or m.tool_call_id}): {m.content}" if m.role == "tool" else m.content
            contents.append({"role": "model" if m.role == "assistant" else "user", "parts": [{"text": text}]})
        body: Dict[str, Any] = {"contents": contents}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        gen: Dict[str, Any] = {}
        if request.temperature is not None:
            gen["temperature"] = request.temperature
        if request.max_tokens is not None:
            gen["maxOutputTokens"] = request.max_tokens
        if gen:
            body["generationConfig"] = gen
        url = f"{self.base_url}/models/{model}:generateContent"
        data = post_json(self.name, url, body, {"x-goog-api-key": self.api_key}, self.timeout)
        parts = (((data.get("candidates") or [{}])[0]).get("content") or {}).get("parts") or []
        meta = data.get("usageMetadata") or {}
        return ChatResponse(
            content="".join(p.get("text", "") for p in parts),
            tool_calls=[],
            model=model,
            provider=self.name,
            usage=Usage(meta.get("promptTokenCount", 0), meta.get("candidatesTokenCount", 0)),
        )


class EchoProvider:
    """Offline provider for tests, demos and CI — no network, no API key."""

    name = "echo"

    def chat(self, request: ChatRequest) -> ChatResponse:
        last_user = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
        content = f"Echo: {last_user}"
        total = sum(len(m.content) for m in request.messages)
        return ChatResponse(content, [], request.model or "echo-1", self.name,
                            Usage(-(-total // 4), -(-len(content) // 4)))
