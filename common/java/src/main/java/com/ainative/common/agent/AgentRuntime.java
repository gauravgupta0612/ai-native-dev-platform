package com.ainative.common.agent;

import com.ainative.common.context.ContextManager;
import com.ainative.common.model.*;
import com.ainative.common.observability.Logger;
import com.ainative.common.router.ModelRouter;
import com.ainative.common.router.RouteOptions;
import com.ainative.common.security.AuditLog;
import com.ainative.common.security.PolicyGuardrails;
import com.ainative.common.tools.ToolRegistry;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Agent loop: ask model -> run requested tools -> feed results back -> repeat until the model answers.
 * Security: input checks, secret masking before every send, tool policy + approval, prompt-injection
 * flagging of tool output, step/tool/token budgets and a hash-chained audit trail.
 */
public class AgentRuntime {
    /** stoppedReason: completed, max-steps, blocked, budget, max-tool-calls. */
    public record Result(String output, int steps, int toolCalls, Usage usage, String stoppedReason) {}

    private final ModelRouter router;
    private ToolRegistry tools = new ToolRegistry();
    private PolicyGuardrails guardrails = new PolicyGuardrails();
    private AuditLog audit = new AuditLog();
    private Logger logger;
    private ToolRegistry.Approver approver;
    private int maxSteps = 8;
    private int maxToolCalls = 25;
    private Integer maxTotalTokens;
    private final String name;

    public AgentRuntime(String name, ModelRouter router) {
        this.name = name;
        this.router = router;
        this.logger = new Logger(name);
    }

    public AgentRuntime tools(ToolRegistry t) { this.tools = t; return this; }
    public AgentRuntime guardrails(PolicyGuardrails g) { this.guardrails = g; return this; }
    public AgentRuntime audit(AuditLog a) { this.audit = a; return this; }
    public AgentRuntime logger(Logger l) { this.logger = l; return this; }
    public AgentRuntime approver(ToolRegistry.Approver a) { this.approver = a; return this; }
    public AgentRuntime maxSteps(int n) { this.maxSteps = n; return this; }
    public AgentRuntime maxToolCalls(int n) { this.maxToolCalls = n; return this; }
    public AgentRuntime maxTotalTokens(int n) { this.maxTotalTokens = n; return this; }

    public Result run(String task) { return run(task, new ContextManager(), RouteOptions.NONE); }

    public Result run(String task, ContextManager context, RouteOptions route) {
        Usage usage = Usage.ZERO;
        PolicyGuardrails.CheckResult check = guardrails.checkInput(task);
        if (!check.allowed()) {
            audit.record(name, "input.blocked", Map.of("reasons", check.reasons()));
            return new Result("Request blocked: " + String.join("; ", check.reasons()), 0, 0, usage, "blocked");
        }
        String safeTask = guardrails.redact(task);
        context.addUser(safeTask);
        audit.record(name, "run.start", Map.of("task", safeTask.substring(0, Math.min(200, safeTask.length())), "sensitive", route.sensitive()));

        int toolCalls = 0;
        for (int step = 1; step <= maxSteps; step++) {
            List<ChatMessage> messages = context.build().stream()
                    .map(m -> new ChatMessage(m.role(), guardrails.redact(m.content()), m.toolCalls(), m.toolCallId(), m.name()))
                    .toList();
            ChatResponse res = router.chat(ChatRequest.of(messages).withTools(tools.specs()), route);
            usage = usage.plus(res.usage());
            context.addAssistant(res.content(), res.toolCalls());
            if (res.toolCalls().isEmpty()) return finish(res.content(), step, toolCalls, usage, "completed");

            for (ToolCall call : res.toolCalls()) {
                if (toolCalls >= maxToolCalls) {
                    context.addToolResult(call.id(), call.name(), "Skipped: tool call limit reached");
                    continue;
                }
                toolCalls++;
                PolicyGuardrails.CheckResult policy = guardrails.checkTool(call.name());
                ToolRegistry.ToolResult result = policy.allowed()
                        ? tools.execute(call, approver)
                        : new ToolRegistry.ToolResult(call.id(), call.name(), false, String.join("; ", policy.reasons()));
                PolicyGuardrails.Wrapped wrapped = guardrails.wrapUntrusted("tool " + call.name(), guardrails.redact(result.output()));
                audit.record(name, "tool.call", Map.of("tool", call.name(), "ok", result.ok(), "injectionSuspected", !wrapped.suspicious().isEmpty()));
                if (!wrapped.suspicious().isEmpty()) logger.warn("possible prompt injection in tool output", Map.of("tool", call.name()));
                context.addToolResult(call.id(), call.name(), wrapped.text());
            }
            if (maxTotalTokens != null && usage.inputTokens() + usage.outputTokens() >= maxTotalTokens) {
                return finish("Stopped: token budget reached.", step, toolCalls, usage, "budget");
            }
            if (toolCalls >= maxToolCalls) return finish("Stopped: tool call limit reached.", step, toolCalls, usage, "max-tool-calls");
        }
        return finish("Stopped: maximum number of steps reached.", maxSteps, toolCalls, usage, "max-steps");
    }

    private Result finish(String output, int steps, int toolCalls, Usage usage, String reason) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("steps", steps);
        d.put("toolCalls", toolCalls);
        d.put("inputTokens", usage.inputTokens());
        d.put("outputTokens", usage.outputTokens());
        audit.record(name, "run." + reason, d);
        return new Result(output, steps, toolCalls, usage, reason);
    }
}
