"""Append-only audit trail (JSON lines). Writes to a file if a path is given; keeps recent events in memory."""
from __future__ import annotations

import json
import os
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional


@dataclass
class AuditEvent:
    ts: str
    actor: str
    action: str
    details: Dict[str, Any] = field(default_factory=dict)


class AuditLog:
    def __init__(self, file_path: Optional[str] = None, keep_in_memory: int = 1000):
        self.file_path = file_path
        self._recent: Deque[AuditEvent] = deque(maxlen=keep_in_memory)
        if file_path:
            os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)

    def record(self, actor: str, action: str, **details: Any) -> AuditEvent:
        event = AuditEvent(datetime.now(timezone.utc).isoformat(), actor, action, details)
        self._recent.append(event)
        if self.file_path:
            with open(self.file_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(asdict(event), default=str) + "\n")
        return event

    def events(self) -> List[AuditEvent]:
        return list(self._recent)
