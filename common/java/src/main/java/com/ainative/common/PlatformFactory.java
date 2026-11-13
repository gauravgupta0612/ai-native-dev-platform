package com.ainative.common;

import com.ainative.common.config.PlatformConfig;
import com.ainative.common.observability.Logger;
import com.ainative.common.observability.Metrics;
import com.ainative.common.provider.*;
import com.ainative.common.router.ModelRouter;
import com.ainative.common.router.RetryPolicy;

/** Builds a router with every provider that has settings. The offline echo provider is always added last. */
public final class PlatformFactory {
    private PlatformFactory() {}

    public static ModelRouter createRouter(PlatformConfig cfg) {
        ModelRouter router = new ModelRouter(new Logger("platform.router"), new Metrics(), RetryPolicy.of(cfg.maxRetries()));
        if (cfg.anthropic().hasKey()) {
            router.register(new AnthropicProvider(cfg.anthropic().apiKey(), cfg.anthropic().model(), cfg.anthropic().baseUrl(), java.time.Duration.ofSeconds(60)));
        }
        if (cfg.openai().hasKey()) {
            router.register(new OpenAICompatibleProvider("openai", cfg.openai().baseUrl(), cfg.openai().apiKey(), cfg.openai().model()));
        }
        if (cfg.gemini().hasKey()) {
            router.register(new GeminiProvider(cfg.gemini().apiKey(), cfg.gemini().model(), cfg.gemini().baseUrl(), java.time.Duration.ofSeconds(60)));
        }
        if (cfg.ollama().enabled()) {
            router.register(new OpenAICompatibleProvider("ollama", cfg.ollama().baseUrl().replaceAll("/+$", "") + "/v1", null, cfg.ollama().model()), false, true);
        }
        if (cfg.custom().baseUrl() != null) {
            router.register(new OpenAICompatibleProvider("custom", cfg.custom().baseUrl(), cfg.custom().apiKey(), cfg.custom().model()));
        }
        router.register(new EchoProvider());
        if (!"auto".equals(cfg.defaultProvider()) && router.listProviders().contains(cfg.defaultProvider())) {
            router.setDefault(cfg.defaultProvider());
        }
        return router;
    }
}
