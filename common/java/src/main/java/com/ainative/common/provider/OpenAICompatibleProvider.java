package com.ainative.common.provider;

import com.ainative.common.json.Json;
import com.ainative.common.model.*;

import java.time.Duration;
import java.util.*;

/**
 * OpenAI and every OpenAI-compatible endpoint:
 * Ollama (http://localhost:11434/v1), LM Studio, vLLM, in-house gateways.
 */
public class OpenAICompatibleProvider implements ModelProvider {
    private final String name;
    private final String baseUrl;
    private final String apiKey;
    private final String defaultModel;
    private final Duration timeout;

    public OpenAICompatibleProvider(String name, String baseUrl, String apiKey, String defaultModel) {
        this(name, baseUrl, apiKey, defaultModel, Duration.ofSeconds(60));
    }

    public OpenAICompatibleProvider(String name, String baseUrl, String apiKey, String defaultModel, Duration timeout) {
        this.name = name;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        this.timeout = timeout;
    }

    @Override
    public String name() { return name; }

    @Override
    public ChatResponse chat(ChatRequest req) {
        String model = req.model() != null ? req.model() : defaultModel;
        List<Object> messages = new ArrayList<>();
        for (ChatMessage m : req.messages()) {
            Map<String, Object> out = new LinkedHashMap<>();
            if ("tool".equals(m.role())) {
                out.put("role", "tool");
                out.put("tool_call_id", m.toolCallId());
                out.put("content", m.content());
            } else if ("assistant".equals(m.role()) && !m.toolCalls().isEmpty()) {
                out.put("role", "assistant");
                out.put("content", m.content());
                List<Object> calls = new ArrayList<>();
                for (ToolCall c : m.toolCalls()) {
                    calls.add(Map.of("id", c.id(), "type", "function",
                            "function", Map.of("name", c.name(), "arguments", Json.stringify(c.arguments()))));
                }
                out.put("tool_calls", calls);
            } else {
                out.put("role", m.role());
                out.put("content", m.content());
            }
            messages.add(out);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("messages", messages);
        body.put("temperature", req.temperature());
        body.put("max_tokens", req.maxTokens());
        if (!req.tools().isEmpty()) {
            List<Object> tools = new ArrayList<>();
            for (ToolSpec t : req.tools()) {
                tools.add(Map.of("type", "function", "function",
                        Map.of("name", t.name(), "description", t.description(), "parameters", t.parameters())));
            }
            body.put("tools", tools);
        }
        Map<String, String> headers = apiKey == null || apiKey.isBlank() ? Map.of() : Map.of("Authorization", "Bearer " + apiKey);
        Map<String, Object> data = HttpJson.post(name, baseUrl + "/chat/completions", body, headers, timeout);

        List<Object> choices = Json.arr(data.get("choices"));
        Map<String, Object> msg = Json.obj(choices.isEmpty() ? null : Json.obj(choices.get(0)).get("message"));
        List<ToolCall> calls = new ArrayList<>();
        for (Object o : Json.arr(msg.get("tool_calls"))) {
            Map<String, Object> c = Json.obj(o);
            Map<String, Object> fn = Json.obj(c.get("function"));
            calls.add(new ToolCall(Json.str(c.get("id"), ""), Json.str(fn.get("name"), ""), HttpJson.parseArgs(fn.get("arguments"))));
        }
        Map<String, Object> usage = Json.obj(data.get("usage"));
        return new ChatResponse(Json.str(msg.get("content"), ""), calls, Json.str(data.get("model"), model), name,
                new Usage(Json.integer(usage.get("prompt_tokens")), Json.integer(usage.get("completion_tokens"))));
    }
}
