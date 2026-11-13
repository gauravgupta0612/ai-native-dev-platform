# ai-native-common (Java)

Requires Java 17+. It has no runtime dependencies: it uses `java.net.http` and includes its own small JSON helper. JUnit is used for tests only.

```bash
mvn test                        # run tests (offline)
mvn -q compile exec:java        # run BasicAgentExample
mvn package                     # build target/ai-native-common-0.1.0.jar
```

```java
PlatformConfig config = PlatformConfig.load();               // env vars + .env
ModelRouter router = PlatformFactory.createRouter(config);
router.addRule(new RouteRule("code-generation", "anthropic"));

ToolRegistry tools = new ToolRegistry().register(
    new ToolSpec("read_file", "Read a file", Map.of("type", "object", "properties", Map.of("path", Map.of("type", "string")))),
    args -> Files.readString(Path.of((String) args.get("path"))));

AgentRuntime agent = new AgentRuntime("my-agent", router)
    .tools(tools)
    .guardrails(new PolicyGuardrails().denyTool("shell"))
    .audit(new AuditLog("logs/audit.jsonl"));

AgentRuntime.Result result = agent.run("Summarize README.md", new ContextManager(), RouteOptions.task("code-generation"));
```

Packages are under `com.ainative.common`: `model`, `provider`, `router`, `config`, `context`, `tools`, `agent`, `security`, `observability`, `json`.
