package com.ainative.common.router;

import com.ainative.common.model.*;
import com.ainative.common.observability.Logger;
import com.ainative.common.observability.Metrics;

import java.util.*;

/** Picks the provider/model for each request, with automatic fallback on failure. */
public class ModelRouter {
    /** A routing candidate. */
    public record Candidate(String provider, String model) {}

    private final Map<String, ModelProvider> providers = new LinkedHashMap<>();
    private final List<RouteRule> rules = new ArrayList<>();
    private List<String> fallbackOrder = new ArrayList<>();
    private String defaultProvider;
    private String localProvider;
    private final Logger logger;
    private final Metrics metrics;

    public ModelRouter() { this(new Logger("router"), new Metrics()); }

    public ModelRouter(Logger logger, Metrics metrics) {
        this.logger = logger;
        this.metrics = metrics;
    }

    public ModelRouter register(ModelProvider p) { return register(p, false, false); }

    public ModelRouter register(ModelProvider p, boolean isDefault, boolean isLocal) {
        providers.put(p.name(), p);
        fallbackOrder.add(p.name());
        if (isDefault || defaultProvider == null) defaultProvider = p.name();
        if (isLocal) localProvider = p.name();
        return this;
    }

    public ModelRouter addRule(RouteRule rule) { rules.add(rule); return this; }

    public ModelRouter setDefault(String name) {
        if (!providers.containsKey(name)) throw new IllegalArgumentException("Unknown provider: " + name);
        defaultProvider = name;
        return this;
    }

    public ModelRouter setFallbackOrder(List<String> names) {
        fallbackOrder = new ArrayList<>(names.stream().filter(providers::containsKey).toList());
        return this;
    }

    public List<String> listProviders() { return new ArrayList<>(providers.keySet()); }

    public Metrics metrics() { return metrics; }

    public List<Candidate> plan(RouteOptions opts) {
        if (opts.sensitive()) {
            if (localProvider == null) throw new IllegalStateException("Sensitive request but no local provider is registered");
            return List.of(new Candidate(localProvider, null));
        }
        List<Candidate> out = new ArrayList<>();
        if (opts.task() != null) {
            rules.stream().filter(r -> r.task().equals(opts.task()) && providers.containsKey(r.provider())).findFirst()
                    .ifPresent(r -> out.add(new Candidate(r.provider(), r.model())));
        }
        if (defaultProvider != null) out.add(new Candidate(defaultProvider, null));
        for (String n : fallbackOrder) out.add(new Candidate(n, null));
        Set<String> seen = new HashSet<>();
        return out.stream().filter(c -> seen.add(c.provider())).toList();
    }

    public ChatResponse chat(ChatRequest req) { return chat(req, RouteOptions.NONE); }

    public ChatResponse chat(ChatRequest req, RouteOptions opts) {
        List<Candidate> candidates = plan(opts);
        if (candidates.isEmpty()) throw new IllegalStateException("No model provider registered");
        RuntimeException last = null;
        for (Candidate c : candidates) {
            ModelProvider p = providers.get(c.provider());
            long started = System.currentTimeMillis();
            try {
                ChatResponse res = p.chat(req.model() == null && c.model() != null ? req.withModel(c.model()) : req);
                metrics.record(p.name(), res.usage(), System.currentTimeMillis() - started, true);
                logger.debug("model call ok", Map.of("provider", p.name(), "model", res.model()));
                return res;
            } catch (RuntimeException e) {
                last = e;
                metrics.record(p.name(), Usage.ZERO, System.currentTimeMillis() - started, false);
                logger.warn("model call failed, trying next provider", Map.of("provider", p.name(), "error", String.valueOf(e.getMessage())));
            }
        }
        throw last;
    }
}
