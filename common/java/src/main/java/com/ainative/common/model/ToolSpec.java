package com.ainative.common.model;

import java.util.Map;

/** Describes a tool to the model. {@code parameters} is a JSON Schema object. */
public record ToolSpec(String name, String description, Map<String, Object> parameters) {
    public ToolSpec {
        parameters = parameters == null ? Map.of("type", "object", "properties", Map.of()) : parameters;
    }
}
