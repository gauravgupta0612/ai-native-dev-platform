package com.ainative.common.model;

import java.util.Map;

/** A model's request to run a tool. */
public record ToolCall(String id, String name, Map<String, Object> arguments) {
    public ToolCall {
        arguments = arguments == null ? Map.of() : arguments;
    }
}
