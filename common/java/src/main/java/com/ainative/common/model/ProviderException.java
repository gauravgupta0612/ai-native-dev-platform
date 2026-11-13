package com.ainative.common.model;

/** Raised when a model provider call fails. */
public class ProviderException extends RuntimeException {
    private final String provider;
    private final int status;

    public ProviderException(String provider, String message, int status) {
        super("[" + provider + "] " + message);
        this.provider = provider;
        this.status = status;
    }

    public ProviderException(String provider, String message, Throwable cause) {
        super("[" + provider + "] " + message, cause);
        this.provider = provider;
        this.status = -1;
    }

    public String provider() { return provider; }

    /** HTTP status; -1 = network error/timeout, 0 = refused locally (e.g. insecure URL). */
    public int status() { return status; }

    /** Network errors, timeouts, 408, 429 and 5xx are worth retrying; other 4xx and local refusals are not. */
    public boolean retryable() { return status == -1 || status == 408 || status == 429 || status >= 500; }
}
