"""Policy & guardrails: mask secrets/PII, block forbidden input, control which tools may run."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional, Pattern

SECRET_PATTERNS: List[Pattern[str]] = [
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),  # OpenAI / Anthropic style keys
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),  # Google API keys
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),  # GitHub tokens
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),  # AWS access key ids
    re.compile(r"\bxox[abpr]-[A-Za-z0-9-]{10,}\b"),  # Slack tokens
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
]
KEY_VALUE = re.compile(r"\b(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*[\"']?[^\s\"']{4,}", re.IGNORECASE)
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")


@dataclass
class CheckResult:
    allowed: bool
    reasons: List[str] = field(default_factory=list)


class PolicyGuardrails:
    def __init__(self, extra_secret_patterns: Optional[List[str]] = None, blocked_patterns: Optional[List[str]] = None,
                 allowed_tools: Optional[List[str]] = None, denied_tools: Optional[List[str]] = None, mask_emails: bool = True):
        self.extra = [re.compile(p) for p in (extra_secret_patterns or [])]
        self.blocked = [re.compile(p, re.IGNORECASE) for p in (blocked_patterns or [])]
        self.allowed_tools = allowed_tools
        self.denied_tools = denied_tools or []
        self.mask_emails = mask_emails

    def redact(self, text: str) -> str:
        """Replaces secrets (and e-mails) with "xxxx"."""
        out = text
        for p in SECRET_PATTERNS + self.extra:
            out = p.sub("xxxx", out)
        out = KEY_VALUE.sub(lambda m: f"{m.group(1)}=xxxx", out)
        if self.mask_emails:
            out = EMAIL.sub("xxxx", out)
        return out

    def check_input(self, text: str) -> CheckResult:
        reasons = [f"Blocked pattern: {p.pattern}" for p in self.blocked if p.search(text)]
        return CheckResult(not reasons, reasons)

    def check_tool(self, name: str) -> CheckResult:
        if name in self.denied_tools:
            return CheckResult(False, [f"Tool denied by policy: {name}"])
        if self.allowed_tools is not None and name not in self.allowed_tools:
            return CheckResult(False, [f"Tool not in allow-list: {name}"])
        return CheckResult(True)
