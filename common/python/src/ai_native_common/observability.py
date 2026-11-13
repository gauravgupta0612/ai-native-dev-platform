"""Structured logging and usage metrics."""
from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict

from .types import Usage

_ORDER = {"debug": 10, "info": 20, "warn": 30, "error": 40}


class Logger:
    """JSON-line logger. Level from LOG_LEVEL env (default "info")."""

    sink: Callable[[str], None] = staticmethod(lambda line: print(line, file=sys.stderr))

    def __init__(self, component: str, level: str | None = None):
        self.component = component
        env = os.environ.get("LOG_LEVEL", "info").lower()
        self.level = level or (env if env in _ORDER else "info")

    def child(self, component: str) -> "Logger":
        return Logger(f"{self.component}.{component}", self.level)

    def _log(self, level: str, msg: str, **data: Any) -> None:
        if _ORDER[level] < _ORDER[self.level]:
            return
        line = {"ts": datetime.now(timezone.utc).isoformat(), "level": level, "component": self.component, "msg": msg, **data}
        Logger.sink(json.dumps(line, default=str))

    def debug(self, msg: str, **data: Any) -> None: self._log("debug", msg, **data)
    def info(self, msg: str, **data: Any) -> None: self._log("info", msg, **data)
    def warn(self, msg: str, **data: Any) -> None: self._log("warn", msg, **data)
    def error(self, msg: str, **data: Any) -> None: self._log("error", msg, **data)


@dataclass
class ProviderStats:
    calls: int = 0
    failures: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_latency_ms: int = 0


class Metrics:
    """In-memory usage counters per provider (tokens, calls, latency)."""

    def __init__(self) -> None:
        self._stats: Dict[str, ProviderStats] = {}

    def record(self, provider: str, usage: Usage, latency_ms: int, ok: bool) -> None:
        s = self._stats.setdefault(provider, ProviderStats())
        s.calls += 1
        s.failures += 0 if ok else 1
        s.input_tokens += usage.input_tokens
        s.output_tokens += usage.output_tokens
        s.total_latency_ms += latency_ms

    def snapshot(self) -> Dict[str, Dict[str, int]]:
        return {
            name: {**s.__dict__, "avg_latency_ms": round(s.total_latency_ms / s.calls) if s.calls else 0}
            for name, s in self._stats.items()
        }


def now_ms() -> int:
    return int(time.monotonic() * 1000)
