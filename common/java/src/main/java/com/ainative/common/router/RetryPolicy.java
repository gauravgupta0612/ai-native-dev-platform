package com.ainative.common.router;

import java.time.Duration;

/**
 * Retries on the same provider for retryable errors (429, 5xx, network) before falling back.
 * Delay doubles each attempt (with jitter), capped at maxDelay.
 */
public record RetryPolicy(int maxRetries, Duration baseDelay, Duration maxDelay) {
    public static final RetryPolicy DEFAULT = new RetryPolicy(2, Duration.ofMillis(500), Duration.ofSeconds(8));
    public static final RetryPolicy NONE = new RetryPolicy(0, Duration.ZERO, Duration.ZERO);

    public static RetryPolicy of(int maxRetries) { return new RetryPolicy(maxRetries, DEFAULT.baseDelay, DEFAULT.maxDelay); }
}
