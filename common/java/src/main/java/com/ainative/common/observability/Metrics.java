package com.ainative.common.observability;

import com.ainative.common.model.Usage;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** In-memory usage counters per provider (tokens, calls, latency). Thread-safe. */
public class Metrics {
    public static final class ProviderStats {
        public long calls, failures, inputTokens, outputTokens, totalLatencyMs;

        public long avgLatencyMs() { return calls == 0 ? 0 : Math.round((double) totalLatencyMs / calls); }

        @Override
        public String toString() {
            return "{calls=" + calls + ", failures=" + failures + ", inputTokens=" + inputTokens
                    + ", outputTokens=" + outputTokens + ", avgLatencyMs=" + avgLatencyMs() + "}";
        }
    }

    private final Map<String, ProviderStats> stats = new ConcurrentHashMap<>();

    public void record(String provider, Usage usage, long latencyMs, boolean ok) {
        ProviderStats s = stats.computeIfAbsent(provider, k -> new ProviderStats());
        synchronized (s) {
            s.calls++;
            if (!ok) s.failures++;
            s.inputTokens += usage.inputTokens();
            s.outputTokens += usage.outputTokens();
            s.totalLatencyMs += latencyMs;
        }
    }

    public Map<String, ProviderStats> snapshot() { return new LinkedHashMap<>(stats); }
}
