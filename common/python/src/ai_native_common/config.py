"""Settings from environment variables (or a local .env file). Never hard-code keys."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Mapping, MutableMapping, Optional


def load_dotenv(path: str = ".env", env: Optional[MutableMapping[str, str]] = None) -> None:
    """Parses KEY=VALUE lines. Existing environment variables win over the file."""
    env = os.environ if env is None else env
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            env.setdefault(key, value)


@dataclass
class ProviderSettings:
    api_key: Optional[str]
    base_url: Optional[str]
    model: str
    enabled: bool = True


@dataclass
class PlatformConfig:
    default_provider: str
    openai: ProviderSettings
    anthropic: ProviderSettings
    gemini: ProviderSettings
    ollama: ProviderSettings
    custom: ProviderSettings
    audit_log_path: Optional[str] = None
    max_agent_steps: int = 8
    extra: dict = field(default_factory=dict)


def load_config(env: Optional[Mapping[str, str]] = None) -> PlatformConfig:
    env = os.environ if env is None else env

    def v(key: str, default: Optional[str] = None) -> Optional[str]:
        value = (env.get(key) or "").strip()
        return value or default

    return PlatformConfig(
        default_provider=v("DEFAULT_PROVIDER", "auto"),
        openai=ProviderSettings(v("OPENAI_API_KEY"), v("OPENAI_BASE_URL", "https://api.openai.com/v1"), v("OPENAI_MODEL", "gpt-4o-mini")),
        anthropic=ProviderSettings(v("ANTHROPIC_API_KEY"), v("ANTHROPIC_BASE_URL", "https://api.anthropic.com"), v("ANTHROPIC_MODEL", "claude-sonnet-4-5")),
        gemini=ProviderSettings(v("GEMINI_API_KEY"), v("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"), v("GEMINI_MODEL", "gemini-2.5-flash")),
        ollama=ProviderSettings(None, v("OLLAMA_BASE_URL", "http://localhost:11434"), v("OLLAMA_MODEL", "llama3.1"),
                                enabled=(v("OLLAMA_ENABLED", "false") or "").lower() == "true"),
        custom=ProviderSettings(v("CUSTOM_API_KEY"), v("CUSTOM_API_URL"), v("CUSTOM_MODEL", "default")),
        audit_log_path=v("AUDIT_LOG_PATH"),
        max_agent_steps=int(v("MAX_AGENT_STEPS", "8") or 8),
    )
