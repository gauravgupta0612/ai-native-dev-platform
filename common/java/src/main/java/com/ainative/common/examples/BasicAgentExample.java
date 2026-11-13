package com.ainative.common.examples;

import com.ainative.common.PlatformFactory;
import com.ainative.common.agent.AgentRuntime;
import com.ainative.common.config.PlatformConfig;
import com.ainative.common.context.ContextManager;
import com.ainative.common.model.ToolSpec;
import com.ainative.common.router.ModelRouter;
import com.ainative.common.router.RouteOptions;
import com.ainative.common.router.RouteRule;
import com.ainative.common.security.AuditLog;
import com.ainative.common.security.PolicyGuardrails;
import com.ainative.common.tools.ToolRegistry;

import java.time.LocalDateTime;
import java.util.Map;

/** Uses real providers when keys are in .env / environment, otherwise the offline echo provider. */
public class BasicAgentExample {
    public static void main(String[] args) {
        PlatformConfig config = PlatformConfig.load();
        ModelRouter router = PlatformFactory.createRouter(config);
        router.addRule(new RouteRule("code-generation", router.listProviders().get(0)));

        ToolRegistry tools = new ToolRegistry().register(
                new ToolSpec("get_time", "Returns the current date and time (ISO 8601).", Map.of("type", "object", "properties", Map.of())),
                a -> LocalDateTime.now().toString());

        AgentRuntime agent = new AgentRuntime("demo-agent", router)
                .tools(tools)
                .guardrails(new PolicyGuardrails().denyTool("delete_file"))
                .audit(new AuditLog(config.auditLogPath()))
                .maxSteps(config.maxAgentSteps());

        AgentRuntime.Result result = agent.run("What time is it? Use the get_time tool.", new ContextManager(), RouteOptions.task("code-generation"));
        System.out.println("Providers: " + String.join(", ", router.listProviders()));
        System.out.println("Answer   : " + result.output());
        System.out.println("Steps    : " + result.steps() + " | tool calls: " + result.toolCalls());
        System.out.println("Metrics  : " + router.metrics().snapshot());
    }
}
