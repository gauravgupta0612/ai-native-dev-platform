package com.ainative.common.tools;

import com.ainative.common.json.Json;
import com.ainative.common.model.ToolCall;
import com.ainative.common.model.ToolSpec;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.regex.Pattern;

/**
 * Holds the tools agents may use and executes them safely: argument validation against the JSON schema,
 * approval for risky tools, timeouts, output size cap, and errors returned as results instead of crashing.
 */
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

    /** {@code timeout} null = registry default. */
    public record ToolDefinition(ToolSpec spec, ToolHandler handler, boolean requiresApproval, Duration timeout) {
        public ToolDefinition(ToolSpec spec, ToolHandler handler, boolean requiresApproval) { this(spec, handler, requiresApproval, null); }
    }

    public record ToolResult(String callId, String name, boolean ok, String output) {}

    private static final Pattern NAME = Pattern.compile("^[A-Za-z][A-Za-z0-9_-]{0,63}$");
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "tool-worker");
        t.setDaemon(true);
        return t;
    });

    private final Map<String, ToolDefinition> tools = new LinkedHashMap<>();
    private final Duration timeout;
    private final int maxOutputChars;

    public ToolRegistry() { this(Duration.ofSeconds(30), 20_000); }

    public ToolRegistry(Duration timeout, int maxOutputChars) {
        this.timeout = timeout;
        this.maxOutputChars = maxOutputChars;
    }

    public ToolRegistry register(ToolSpec spec, ToolHandler handler) { return register(new ToolDefinition(spec, handler, false)); }

    public ToolRegistry register(ToolSpec spec, ToolHandler handler, boolean requiresApproval) {
        return register(new ToolDefinition(spec, handler, requiresApproval));
    }

    public ToolRegistry register(ToolDefinition def) {
        String name = def.spec().name();
        if (!NAME.matcher(name).matches()) throw new IllegalArgumentException("Invalid tool name: " + name);
        if (tools.containsKey(name)) throw new IllegalArgumentException("Tool already registered: " + name);
        tools.put(name, def);
        return this;
    }

    public ToolRegistry registerAll(List<ToolDefinition> defs) {
        defs.forEach(this::register);
        return this;
    }

    public boolean has(String name) { return tools.containsKey(name); }

    public List<ToolSpec> specs() { return tools.values().stream().map(ToolDefinition::spec).toList(); }

    public ToolResult execute(ToolCall call, Approver approver) {
        ToolDefinition def = tools.get(call.name());
        if (def == null) return fail(call, "Unknown tool: " + call.name());
        List<String> problems = SchemaValidator.validate(def.spec().parameters(), call.arguments());
        if (!problems.isEmpty()) return fail(call, "Invalid arguments: " + String.join("; ", problems));
        if (def.requiresApproval() && (approver == null || !approver.approve(call))) {
            return fail(call, "Denied: tool call was not approved");
        }
        Duration limit = def.timeout() != null ? def.timeout() : timeout;
        Future<Object> future = EXECUTOR.submit(() -> def.handler().handle(call.arguments()));
        try {
            Object value = future.get(limit.toMillis(), TimeUnit.MILLISECONDS);
            String output = value instanceof String s ? s : Json.stringify(value);
            if (output.length() > maxOutputChars) {
                output = output.substring(0, maxOutputChars) + "\n…[truncated " + (output.length() - maxOutputChars) + " characters]";
            }
            return new ToolResult(call.id(), call.name(), true, output);
        } catch (TimeoutException e) {
            future.cancel(true);
            return fail(call, "Error: timed out after " + limit.toMillis() + " ms");
        } catch (ExecutionException e) {
            return fail(call, "Error: " + e.getCause().getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return fail(call, "Error: interrupted");
        }
    }

    private static ToolResult fail(ToolCall call, String msg) { return new ToolResult(call.id(), call.name(), false, msg); }
}
