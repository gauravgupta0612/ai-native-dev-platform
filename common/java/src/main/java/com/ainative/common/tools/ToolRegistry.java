package com.ainative.common.tools;

import com.ainative.common.json.Json;
import com.ainative.common.model.ToolCall;
import com.ainative.common.model.ToolSpec;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Holds the tools agents may use and executes them safely (errors become results, not crashes). */
public class ToolRegistry {
    /** Implementation of a tool. Return a String or any object (serialized to JSON). */
    @FunctionalInterface
    public interface ToolHandler {
        Object handle(Map<String, Object> args) throws Exception;
    }

    /** Return true to allow a tool call (UI prompt, policy, or auto-approve in tests). */
    @FunctionalInterface
    public interface Approver {
        boolean approve(ToolCall call);
    }

    public record ToolDefinition(ToolSpec spec, ToolHandler handler, boolean requiresApproval) {}

    public record ToolResult(String callId, String name, boolean ok, String output) {}

    private final Map<String, ToolDefinition> tools = new LinkedHashMap<>();

    public ToolRegistry register(ToolSpec spec, ToolHandler handler) { return register(spec, handler, false); }

    public ToolRegistry register(ToolSpec spec, ToolHandler handler, boolean requiresApproval) {
        if (tools.containsKey(spec.name())) throw new IllegalArgumentException("Tool already registered: " + spec.name());
        tools.put(spec.name(), new ToolDefinition(spec, handler, requiresApproval));
        return this;
    }

    public boolean has(String name) { return tools.containsKey(name); }

    public List<ToolSpec> specs() { return tools.values().stream().map(ToolDefinition::spec).toList(); }

    public ToolResult execute(ToolCall call, Approver approver) {
        ToolDefinition def = tools.get(call.name());
        if (def == null) return new ToolResult(call.id(), call.name(), false, "Unknown tool: " + call.name());
        if (def.requiresApproval() && (approver == null || !approver.approve(call))) {
            return new ToolResult(call.id(), call.name(), false, "Denied: tool call was not approved");
        }
        try {
            Object value = def.handler().handle(call.arguments());
            String output = value instanceof String s ? s : Json.stringify(value);
            return new ToolResult(call.id(), call.name(), true, output);
        } catch (Exception e) {
            return new ToolResult(call.id(), call.name(), false, "Error: " + e.getMessage());
        }
    }
}
