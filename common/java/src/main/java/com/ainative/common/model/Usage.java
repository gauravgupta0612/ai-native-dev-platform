package com.ainative.common.model;

/** Token usage reported by a provider. */
public record Usage(int inputTokens, int outputTokens) {
    public static final Usage ZERO = new Usage(0, 0);

    public Usage plus(Usage other) { return new Usage(inputTokens + other.inputTokens, outputTokens + other.outputTokens); }
}
