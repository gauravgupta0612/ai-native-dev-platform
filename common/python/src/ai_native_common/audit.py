"""Tamper-evident, append-only audit trail (JSON lines, hash-chained). Secrets in details are masked."""
from __future__ import annotations

import hashlib
import json
import os
import threading
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Sequence

from .guardrails import redact_secrets

GENESIS = ""


def _hash(prev_hash: str, ts: str, actor: str, action: str, details: Dict[str, Any]) -> str:
    payload = "|".join([prev_hash, ts, actor, action, json.dumps(details, sort_keys=True, default=str)])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass
class AuditEvent:
    ts: str
    actor: str
    action: str
    details: Dict[str, Any] = field(default_factory=dict)
    prev_hash: str = GENESIS
    hash: str = ""


class AuditLog:
    def __init__(self, file_path: Optional[str] = None, keep_in_memory: int = 1000):
        self.file_path = file_path
        self._recent: Deque[AuditEvent] = deque(maxlen=keep_in_memory)
        self._last_hash = GENESIS
        self._lock = threading.Lock()
        if file_path:
            os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
            if os.path.exists(file_path):
                with open(file_path, encoding="utf-8") as fh:
                    lines = [line for line in fh.read().splitlines() if line.strip()]
                if lines:
                    self._last_hash = json.loads(lines[-1]).get("hash", GENESIS)

    def record(self, actor: str, action: str, **details: Any) -> AuditEvent:
        safe = json.loads(redact_secrets(json.dumps(details, default=str), mask_emails=False))
        with self._lock:
            ts = datetime.now(timezone.utc).isoformat()
            event = AuditEvent(ts, actor, action, safe, self._last_hash, _hash(self._last_hash, ts, actor, action, safe))
            self._last_hash = event.hash
            self._recent.append(event)
            if self.file_path:
                with open(self.file_path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(asdict(event)) + "\n")
        return event

    def events(self) -> List[AuditEvent]:
        return list(self._recent)

    @staticmethod
    def verify(events: Sequence[AuditEvent]) -> int:
        """Returns the index of the first broken event, or -1 if the chain is intact."""
        for i, e in enumerate(events):
            if i > 0 and e.prev_hash != events[i - 1].hash:
                return i
            if _hash(e.prev_hash, e.ts, e.actor, e.action, e.details) != e.hash:
                return i
        return -1

    @staticmethod
    def verify_file(file_path: str) -> int:
        """Verifies a whole audit file. Returns -1 if intact, otherwise the 0-based line that was altered."""
        with open(file_path, encoding="utf-8") as fh:
            events = [AuditEvent(**json.loads(line)) for line in fh.read().splitlines() if line.strip()]
        if events and events[0].prev_hash != GENESIS:
            return 0
        return AuditLog.verify(events)
