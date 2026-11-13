"""Builds a router from config. The offline echo provider is always added last."""
from __future__ import annotations

from typing import Optional

from .config import PlatformConfig
from .observability import Logger
from .providers import AnthropicProvider, EchoProvider, GeminiProvider, OpenAICompatibleProvider
from .router import ModelRouter, RetryPolicy


def create_router(cfg: PlatformConfig, logger: Optional[Logger] = None) -> ModelRouter:
    logger = logger or Logger("platform")
    router = ModelRouter(logger.child("router"), retry=RetryPolicy(max_retries=cfg.max_retries))
    if cfg.anthropic.api_key:
        router.register(AnthropicProvider(cfg.anthropic.api_key, cfg.anthropic.model, cfg.anthropic.base_url))
    if cfg.openai.api_key:
        router.register(OpenAICompatibleProvider("openai", cfg.openai.base_url, cfg.openai.model, cfg.openai.api_key))
    if cfg.gemini.api_key:
        router.register(GeminiProvider(cfg.gemini.api_key, cfg.gemini.model, cfg.gemini.base_url))
    if cfg.ollama.enabled:
        router.register(OpenAICompatibleProvider("ollama", f"{cfg.ollama.base_url.rstrip('/')}/v1", cfg.ollama.model), is_local=True)
    if cfg.custom.base_url:
        router.register(OpenAICompatibleProvider("custom", cfg.custom.base_url, cfg.custom.model, cfg.custom.api_key))
    router.register(EchoProvider())
    if cfg.default_provider != "auto" and cfg.default_provider in router.list_providers():
        router.set_default(cfg.default_provider)
    return router
