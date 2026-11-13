/**
 * Run:  npm run example
 * Uses real providers when keys are in .env, otherwise the offline echo provider.
 */
import { AgentRuntime, AuditLog, PolicyGuardrails, ToolRegistry, createRouter, loadConfig, loadDotEnv } from "../src";

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const router = createRouter(config);
  router.addRule({ task: "code-generation", provider: router.listProviders()[0] });

  const tools = new ToolRegistry().register({
    spec: {
      name: "get_time",
      description: "Returns the current date and time (ISO 8601).",
      parameters: { type: "object", properties: {} },
    },
    handler: () => new Date().toISOString(),
  });

  const agent = new AgentRuntime({
    name: "demo-agent",
    router,
    tools,
    guardrails: new PolicyGuardrails({ deniedTools: ["delete_file"] }),
    audit: new AuditLog(config.auditLogPath),
    maxSteps: config.maxAgentSteps,
  });

  const result = await agent.run("What time is it? Use the get_time tool.", undefined, { task: "code-generation" });
  console.log("Providers:", router.listProviders().join(", "));
  console.log("Answer   :", result.output);
  console.log("Steps    :", result.steps, "| tool calls:", result.toolCalls);
  console.log("Metrics  :", JSON.stringify(router.metrics.snapshot()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
