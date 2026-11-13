package com.ainative.common.model;

import java.util.List;

/** Provider-neutral chat response. */
public record ChatResponse(String content, List<ToolCall> toolCalls, String model, String provider, Usage usage) {
    public ChatResponse {
        content = content == null ? "" : content;
        toolCalls = toolCalls == null ? List.of() : List.copyOf(toolCalls);
        usage = usage == null ? Usage.ZERO : usage;
    }
}
