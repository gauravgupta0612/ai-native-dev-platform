"""Model router: picks the provider/model for each request, with fallback on failure."""
from __future__ import annotations

import random
import time
from dataclasses import dataclass, replace
from typing import Dict, List, Optional, Tuple

from .observability import Logger, Metrics, now_ms
from .types import ChatRequest, ChatResponse, ModelProvider, ProviderError, Usage


@dataclass
class RouteRule:
    task: str  # e.g. "code-generation", "summarize", "chat"
    provider: str
    model: Optional[str] = None


@dataclass
class RetryPolicy:
    max_retries: int = 2  # extra attempts on the same provider for 429 / 5xx / network errors
    base_delay: float = 0.5  # seconds; doubles each retry, with jitter
    max_delay: float = 8.0


class ModelRouter:
    """Picks the provider/model for each request, retries transient errors, then falls back to the next provider."""

    def __init__(self, logger: Optional[Logger] = None, metrics: Optional[Metrics] = None,
                 retry: Optional[RetryPolicy] = None):
        self.logger = logger or Logger("router")
        self.metrics = metrics or Metrics()
        self.retry = retry or RetryPolicy()
        self._providers: Dict[str, ModelProvider] = {}
        self._rules: List[RouteRule] = []
        self._default: Optional[str] = None
        self._fallback: List[str] = []
        self._local: Optional[str] = None

    def register(self, provider: ModelProvider, is_default: bool = False, is_local: bool = False) -> "ModelRouter":
        self._providers[provider.name] = provider
        self._fallback.append(provider.name)
        if is_default or self._default is None:
            self._default = provider.name
        if is_local:
            self._local = provider.name
        return self

    def add_rule(self, rule: RouteRule) -> "ModelRouter":
        self._rules.append(rule)
        return self

    def set_default(self, name: str) -> "ModelRouter":
        if name not in self._providers:
            raise ValueError(f"Unknown provider: {name}")
        self._default = name
        return self

    def set_fallback_order(self, names: List[str]) -> "ModelRouter":
        self._fallback = [n for n in names if n in self._providers]
        return self

    def list_providers(self) -> List[str]:
        return list(self._providers)

    def plan(self, task: Optional[str] = None, sensitive: bool = False) -> List[Tuple[str, Optional[str]]]:
        """Ordered (provider, model) candidates. Sensitive requests only go to the local provider."""
        if sensitive:
            if not self._local:
                raise RuntimeError("Sensitive request but no local provider is registered")
            return [(self._local, None)]
        out: List[Tuple[str, Optional[str]]] = []
        rule = next((r for r in self._rules if r.task == task), None) if task else None
        if rule and rule.provider in self._providers:
            out.append((rule.provider, rule.model))
        if self._default:
            out.append((self._default, None))
        out += [(n, None) for n in self._fallback]
        seen: set = set()
        return [c for c in out if not (c[0] in seen or seen.add(c[0]))]

    def chat(self, request: ChatRequest, task: Optional[str] = None, sensitive: bool = False) -> ChatResponse:
        candidates = self.plan(task, sensitive)
        if not candidates:
            raise RuntimeError("No model provider registered")
        last_error: Optional[Exception] = None
        for name, model in candidates:
            provider = self._providers[name]
            for attempt in range(self.retry.max_retries + 1):
                started = now_ms()
                try:
                    res = provider.chat(replace(request, model=request.model or model))
                    self.metrics.record(name, res.usage, now_ms() - started, True)
                    self.logger.debug("model call ok", provider=name, model=res.model)
                    return res
                except Exception as err:  # noqa: BLE001 - retry or try the next provider
                    last_error = err
                    self.metrics.record(name, Usage(), now_ms() - started, False)
                    retryable = isinstance(err, ProviderError) and err.retryable
                    if not retryable or attempt == self.retry.max_retries:
                        self.logger.warn("model call failed, trying next provider", provider=name, error=str(err))
                        break
                    delay = min(self.retry.max_delay, self.retry.base_delay * (2 ** attempt))
                    self.logger.info("retrying model call", provider=name, attempt=attempt + 1, delay_s=delay)
                    time.sleep(delay / 2 + random.random() * delay / 2)
        assert last_error is not None
        raise last_error
