package com.ainative.common.agent;

import com.ainative.common.context.ContextManager;
import com.ainative.common.model.*;
import com.ainative.common.observability.Logger;
import com.ainative.common.router.ModelRouter;
import com.ainative.common.router.RouteOptions;
import com.ainative.common.security.AuditLog;
import com.ainative.common.security.PolicyGuardrails;
import com.ainative.common.tools.ToolRegistry;

import java.util.Map;

/**
 * Agent loop: ask model -> run requested tools -> feed results back -> repeat until the model answers.
 * Guardrails mask secrets before sending, and every tool call is policy-checked and audited.
 */
public class AgentRuntime {
    public record Result(String output, int steps, int toolCalls, Usage usage, String stoppedReason) {}

    private final ModelRouter router;
    private ToolRegistry tools = new ToolRegistry();
    private PolicyGuardrails guardrails = new PolicyGuardrails();
    private AuditLog audit = new AuditLog();
    private Logger logger;
    private ToolRegistry.Approver approver;
    private int maxSteps = 8;
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
        audit.record(name, "run.start", Map.of("task", safeTask.substring(0, Math.min(200, safeTask.length()))));

        int toolCalls = 0;
        for (int step = 1; step <= maxSteps; step++) {
            ChatResponse res = router.chat(ChatRequest.of(context.build()).withTools(tools.specs()), route);
            usage = usage.plus(res.usage());
            context.addAssistant(res.content(), res.toolCalls());
            if (res.toolCalls().isEmpty()) {
                audit.record(name, "run.complete", Map.of("steps", step, "provider", res.provider(), "model", res.model()));
                return new Result(res.content(), step, toolCalls, usage, "completed");
            }
            for (ToolCall call : res.toolCalls()) {
                toolCalls++;
                PolicyGuardrails.CheckResult policy = guardrails.checkTool(call.name());
                ToolRegistry.ToolResult result = policy.allowed()
                        ? tools.execute(call, approver)
                        : new ToolRegistry.ToolResult(call.id(), call.name(), false, String.join("; ", policy.reasons()));
                audit.record(name, "tool.call", Map.of("tool", call.name(), "ok", result.ok()));
                logger.debug("tool executed", Map.of("tool", call.name(), "ok", result.ok()));
                context.addToolResult(call.id(), call.name(), guardrails.redact(result.output()));
            }
        }
        audit.record(name, "run.max-steps", Map.of("maxSteps", maxSteps));
        return new Result("Stopped: maximum number of steps reached.", maxSteps, toolCalls, usage, "max-steps");
    }
}
