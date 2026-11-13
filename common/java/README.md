# ai-native-common for Java

Requires **Java 17+**. There are no runtime dependencies: it uses `java.net.http` and includes its own small JSON helper. JUnit is used for tests only.

## 1. Add it to your project

The library is served by **JitPack**, which builds it straight from GitHub; no account or token is needed. Use a release tag as the version.

**Maven**

```xml
<repositories>
  <repository>
    <id>jitpack.io</id>
    <url>https://jitpack.io</url>
  </repository>
</repositories>

<dependencies>
  <dependency>
    <groupId>com.github.gauravgupta0612</groupId>
    <artifactId>ai-native-common</artifactId>
    <version>v0.2.0</version>
  </dependency>
</dependencies>
```

**Gradle (Kotlin DSL)**

```kotlin
repositories { mavenCentral(); maven("https://jitpack.io") }
dependencies { implementation("com.github.gauravgupta0612:ai-native-common:v0.2.0") }
```

The first time someone requests a new tag, JitPack builds it, which takes a minute. The build log is at `https://jitpack.io/#gauravgupta0612/ai-native-dev-platform`.

Other options: run `mvn install` in this folder to use `com.github.gauravgupta0612:ai-native-common:0.2.0` from your local Maven repository, or copy `src/main/java/com/ainative` into your project.

To work on the library itself:

```bash
mvn test                   # 21 offline tests
mvn -q compile exec:java   # runs BasicAgentExample
```

## 2. Configure keys (`.env` in the working folder or environment variables; never commit them)

```env
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
OLLAMA_ENABLED=true            # optional: local model for sensitive data
AUDIT_LOG_PATH=logs/audit.jsonl
```

```java
PlatformConfig config = PlatformConfig.load();          // env vars + .env (env vars win)
System.out.println(config);                             // safe: keys printed as xxxx
ModelRouter router = PlatformFactory.createRouter(config); // every provider with a key, plus "echo"
```

## 3. Simple chat

```java
ChatResponse res = router.chat(ChatRequest.of(List.of(
        ChatMessage.system("You are a concise assistant."),
        ChatMessage.user("Explain RPG free format in 2 lines.")))
    .withTemperature(0.2)
    .withMaxTokens(300));
System.out.println(res.content() + " via " + res.provider() + " " + res.usage());
```

## 4. Routing, retries and fallback

```java
router.addRule(new RouteRule("code-generation", "anthropic"));
router.addRule(new RouteRule("summarize", "openai", "gpt-4o-mini"));
router.setFallbackOrder(List.of("anthropic", "openai", "echo"));

router.chat(request, RouteOptions.task("code-generation")); // 429/5xx retried, then the next provider
router.chat(request, RouteOptions.sensitiveOnly());         // only the local Ollama model
System.out.println(router.metrics().snapshot());
```

You can set the retry policy yourself: `new ModelRouter(new RetryPolicy(3, Duration.ofMillis(500), Duration.ofSeconds(8)))`.

## 5. An agent with your own tools

```java
ToolRegistry tools = new ToolRegistry(Duration.ofSeconds(15), 20_000).register(
    new ToolSpec("get_ticket", "Fetch a Jira ticket by key", Map.of(
        "type", "object",
        "properties", Map.of("key", Map.of("type", "string", "minLength", 3, "maxLength", 20)),
        "required", List.of("key"),
        "additionalProperties", false)),            // arguments are validated before your handler runs
    args -> Map.of("key", args.get("key"), "status", "In Progress"));

AgentRuntime agent = new AgentRuntime("support-agent", router)
    .tools(tools)
    .guardrails(new PolicyGuardrails().allowOnlyTools(List.of("get_ticket")).blockPattern("drop\\s+table"))
    .audit(new AuditLog(config.auditLogPath()))
    .maxSteps(8).maxToolCalls(20).maxTotalTokens(50_000);

AgentRuntime.Result result = agent.run("What is the status of TMS-123?", new ContextManager(), RouteOptions.task("code-generation"));
System.out.println(result.output() + " / " + result.stoppedReason()); // completed | max-steps | budget | max-tool-calls | blocked
```

## 6. Safe file access (workspace tools + approval)

```java
ToolRegistry tools = new ToolRegistry().registerAll(
    WorkspaceTools.create(Path.of("/path/to/repo"), true, 1_000_000, 500, List.of())); // allowWrite = true

AgentRuntime agent = new AgentRuntime("dev-agent", router)
    .tools(tools)
    .approver(call -> askUserInYourUi(call));      // write_file only runs if this returns true
```

`WorkspaceTools.create(path)` gives read-only tools. The agent cannot leave the folder (`../`, absolute paths and symlinks are blocked). It also cannot see `.env`, key/keystore files, `.git`, `target` or `node_modules`.

## 7. Add context (open files, RAG results)

```java
ContextManager ctx = new ContextManager("You are an IBM i expert.", 48_000);
ctx.addSnippet("src/ORDERS.rpgle", fileText);
agent.run("Find the bug in this program", ctx, RouteOptions.NONE);
```

## 8. Audit and verify

```java
int broken = AuditLog.verifyFile(Path.of("logs/audit.jsonl")); // -1 = intact, otherwise the first altered line
```

## 9. Add your own provider

```java
public class MyGatewayProvider implements ModelProvider {
    public String name() { return "my-gateway"; }
    public ChatResponse chat(ChatRequest req) {
        // call your API ...
        return new ChatResponse("answer", List.of(), "my-model", name(), new Usage(10, 5));
    }
}
router.register(new MyGatewayProvider(), true, false); // isDefault, isLocal
```

Any OpenAI-compatible endpoint needs no new code: `new OpenAICompatibleProvider("azure", baseUrl, apiKey, model)`.

## 10. Unit-test your code without a network

Use `EchoProvider`, or a scripted fake `ModelProvider` (see `src/test/java/.../CommonTest.java`).

---

**Packages** (under `com.ainative.common`): `model` · `provider` · `router` · `config` · `context` · `tools` (registry, schema validator, workspace tools) · `agent` · `security` (guardrails, audit) · `observability` · `json`.
