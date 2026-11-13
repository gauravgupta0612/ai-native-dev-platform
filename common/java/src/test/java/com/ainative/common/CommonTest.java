package com.ainative.common;

import com.ainative.common.agent.AgentRuntime;
import com.ainative.common.config.PlatformConfig;
import com.ainative.common.context.ContextManager;
import com.ainative.common.json.Json;
import com.ainative.common.model.*;
import com.ainative.common.observability.Logger;
import com.ainative.common.provider.EchoProvider;
import com.ainative.common.router.ModelRouter;
import com.ainative.common.router.RouteOptions;
import com.ainative.common.router.RouteRule;
import com.ainative.common.security.AuditLog;
import com.ainative.common.security.PolicyGuardrails;
import com.ainative.common.tools.ToolRegistry;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

class CommonTest {
    static { Logger.sink = line -> {}; } // keep test output clean

    /** Replays a fixed list of responses (or throws). */
    static class ScriptedProvider implements ModelProvider {
        final String name;
        final Deque<Object> script;
        final List<ChatRequest> requests = new ArrayList<>();

        ScriptedProvider(String name, Object... script) {
            this.name = name;
            this.script = new ArrayDeque<>(Arrays.asList(script));
        }

        @Override public String name() { return name; }

        @Override public ChatResponse chat(ChatRequest req) {
            requests.add(req);
            Object next = script.poll();
            if (next instanceof RuntimeException e) throw e;
            if (next instanceof ChatResponse r) return r;
            throw new IllegalStateException("script exhausted");
        }
    }

    static ChatResponse text(String s) { return new ChatResponse(s, List.of(), "m", "p", new Usage(1, 1)); }

    @Test void echoWorksOffline() {
        assertEquals("Echo: hi", new EchoProvider().chat(ChatRequest.of(List.of(ChatMessage.user("hi")))).content());
    }

    @Test void routerUsesRuleThenFallsBack() {
        ScriptedProvider bad = new ScriptedProvider("bad", new RuntimeException("down"));
        ScriptedProvider good = new ScriptedProvider("good", text("ok"));
        ModelRouter router = new ModelRouter().register(good).register(bad).addRule(new RouteRule("code", "bad"));
        assertEquals("ok", router.chat(ChatRequest.of(List.of(ChatMessage.user("x"))), RouteOptions.task("code")).content());
        assertEquals(1, router.metrics().snapshot().get("bad").failures);
    }

    @Test void sensitiveGoesLocal() {
        ModelRouter router = new ModelRouter().register(new EchoProvider()).register(new ScriptedProvider("ollama"), false, true);
        assertEquals("ollama", router.plan(RouteOptions.sensitiveOnly()).get(0).provider());
    }

    @Test void guardrailsRedactSecrets() {
        String out = new PolicyGuardrails().redact("key sk-abcdefghijklmnopqrstuv password=hunter22 a.b@example.com");
        assertFalse(out.contains("sk-abc") || out.contains("hunter22") || out.contains("example.com"), out);
    }

    @Test void guardrailsToolAndInputPolicy() {
        PolicyGuardrails g = new PolicyGuardrails().denyTool("shell").blockPattern("drop\\s+table");
        assertFalse(g.checkTool("shell").allowed());
        assertTrue(g.checkTool("read_file").allowed());
        assertFalse(g.checkInput("please DROP TABLE users").allowed());
    }

    @Test void contextTrimsOldTurns() {
        ContextManager ctx = new ContextManager("sys", 50);
        for (int i = 0; i < 10; i++) ctx.addUser("message number " + i);
        List<ChatMessage> msgs = ctx.build();
        assertEquals("system", msgs.get(0).role());
        assertTrue(msgs.size() < 11);
        assertEquals("message number 9", msgs.get(msgs.size() - 1).content());
    }

    @Test void agentRunsToolThenAnswers() {
        ScriptedProvider p = new ScriptedProvider("p",
                new ChatResponse("", List.of(new ToolCall("c1", "add", Map.of("a", 2L, "b", 3L))), "m", "p", new Usage(1, 1)),
                text("The answer is 5"));
        ToolRegistry tools = new ToolRegistry().register(new ToolSpec("add", "Add numbers", null),
                a -> ((Number) a.get("a")).longValue() + ((Number) a.get("b")).longValue());
        AuditLog audit = new AuditLog();
        AgentRuntime.Result r = new AgentRuntime("t", new ModelRouter().register(p)).tools(tools).audit(audit).run("What is 2+3?");
        assertEquals("The answer is 5", r.output());
        assertEquals(1, r.toolCalls());
        ChatMessage toolMsg = p.requests.get(1).messages().stream().filter(m -> m.role().equals("tool")).findFirst().orElseThrow();
        assertEquals("5", toolMsg.content());
        assertTrue(audit.events().stream().anyMatch(e -> e.action().equals("tool.call")));
    }

    @Test void approvalRequired() {
        ToolRegistry tools = new ToolRegistry().register(new ToolSpec("write", "w", null), a -> "written", true);
        assertFalse(tools.execute(new ToolCall("1", "write", null), null).ok());
        assertEquals("written", tools.execute(new ToolCall("2", "write", null), c -> true).output());
    }

    @Test void factoryWithoutKeysUsesEcho() {
        ModelRouter router = PlatformFactory.createRouter(PlatformConfig.from(Map.of()));
        assertEquals(List.of("echo"), router.listProviders());
        assertEquals("echo", router.chat(ChatRequest.of(List.of(ChatMessage.user("ping")))).provider());
    }

    @Test void jsonRoundTrip() {
        Map<String, Object> m = Json.parseObject("{\"a\":[1,2.5,\"x\\n\",true,null],\"b\":{\"c\":\"\\u00e9\"}}");
        assertEquals(1L, Json.arr(m.get("a")).get(0));
        assertEquals("\u00e9", Json.obj(m.get("b")).get("c"));
        assertEquals(m, Json.parseObject(Json.stringify(m)));
    }

    @Test void dotEnvAndAuditFile() throws Exception {
        Path dir = Files.createTempDirectory("ainative");
        Path env = dir.resolve(".env");
        Files.writeString(env, "# comment\nOPENAI_MODEL='my-model'\n");
        assertEquals("my-model", PlatformConfig.from(PlatformConfig.loadDotEnv(env)).openai().model());
        Path log = dir.resolve("logs/audit.jsonl");
        new AuditLog(log.toString()).record("tester", "test.action", Map.of("ok", true));
        assertTrue(Files.readString(log).contains("test.action"));
    }
}
