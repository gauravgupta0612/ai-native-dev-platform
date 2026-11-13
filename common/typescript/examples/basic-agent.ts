/**
 * Run:  npm run example
 * Uses real providers when keys are in .env, otherwise the offline echo provider.
 */
import {
  AgentRuntime, AuditLog, PolicyGuardrails, ToolRegistry, createRouter, createWorkspaceTools,
  loadConfig, loadDotEnv, redactConfig,
} from "../src";

async function main() {
  loadDotEnv();
  const config = loadConfig();
  console.log("Config   :", JSON.stringify(redactConfig(config).openai)); // keys shown as xxxx
  const router = createRouter(config);
  router.addRule({ task: "code-generation", provider: router.listProviders()[0] });

  const tools = new ToolRegistry({ timeoutMs: 15_000 })
    .registerAll(createWorkspaceTools(process.cwd())) // read-only: read_file, list_files, search_text
    .register({
      spec: { name: "get_time", description: "Current date and time (ISO 8601).", parameters: { type: "object", properties: {} } },
      handler: () => new Date().toISOString(),
    });

  const agent = new AgentRuntime({
    name: "demo-agent",
    router,
    tools,
    guardrails: new PolicyGuardrails({ deniedTools: ["delete_file"] }),
    audit: new AuditLog(config.auditLogPath),
    approver: (call) => { console.log(`Approve ${call.name}? -> denied in demo`); return false; },
    maxSteps: config.maxAgentSteps,
    maxTotalTokens: 50_000,
  });

  const result = await agent.run("List the files in this project and tell me what it does.", undefined, { task: "code-generation" });
  console.log("Providers:", router.listProviders().join(", "));
  console.log("Answer   :", result.output);
  console.log("Steps    :", result.steps, "| tool calls:", result.toolCalls, "| stop:", result.stoppedReason);
  console.log("Metrics  :", JSON.stringify(router.metrics.snapshot()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
