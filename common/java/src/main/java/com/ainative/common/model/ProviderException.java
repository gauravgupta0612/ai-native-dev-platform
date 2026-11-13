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
    public int status() { return status; }
}
