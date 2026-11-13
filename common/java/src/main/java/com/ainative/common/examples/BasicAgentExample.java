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
import com.ainative.common.tools.WorkspaceTools;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Map;

/** Uses real providers when keys are in .env / environment, otherwise the offline echo provider. */
public class BasicAgentExample {
    public static void main(String[] args) throws IOException {
        PlatformConfig config = PlatformConfig.load();
        System.out.println("Config   : " + config.openai()); // keys shown as xxxx
        ModelRouter router = PlatformFactory.createRouter(config);
        router.addRule(new RouteRule("code-generation", router.listProviders().get(0)));

        ToolRegistry tools = new ToolRegistry(Duration.ofSeconds(15), 20_000)
                .registerAll(WorkspaceTools.create(Path.of("."))) // read-only file tools
                .register(
                new ToolSpec("get_time", "Returns the current date and time (ISO 8601).", Map.of("type", "object", "properties", Map.of())),
                a -> LocalDateTime.now().toString());

        AgentRuntime agent = new AgentRuntime("demo-agent", router)
                .tools(tools)
                .guardrails(new PolicyGuardrails().denyTool("delete_file"))
                .audit(new AuditLog(config.auditLogPath()))
                .approver(call -> false) // deny risky tools in the demo; plug in a real prompt in your app
                .maxSteps(config.maxAgentSteps())
                .maxTotalTokens(50_000);

        AgentRuntime.Result result = agent.run("List the files in this project and tell me what it does.", new ContextManager(), RouteOptions.task("code-generation"));
        System.out.println("Providers: " + String.join(", ", router.listProviders()));
        System.out.println("Answer   : " + result.output());
        System.out.println("Steps    : " + result.steps() + " | tool calls: " + result.toolCalls() + " | stop: " + result.stoppedReason());
        System.out.println("Metrics  : " + router.metrics().snapshot());
    }
}
