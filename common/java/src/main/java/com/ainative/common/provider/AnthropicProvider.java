package com.ainative.common.provider;

import com.ainative.common.json.Json;
import com.ainative.common.model.*;

import java.time.Duration;
import java.util.*;

/** Anthropic (Claude) Messages API adapter, with tool use. */
public class AnthropicProvider implements ModelProvider {
    private final String apiKey;
    private final String defaultModel;
    private final String baseUrl;
    private final Duration timeout;

    public AnthropicProvider(String apiKey, String defaultModel) {
        this(apiKey, defaultModel, "https://api.anthropic.com", Duration.ofSeconds(60));
    }

    public AnthropicProvider(String apiKey, String defaultModel, String baseUrl, Duration timeout) {
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.timeout = timeout;
    }

    @Override
    public String name() { return "anthropic"; }

    @Override
    public ChatResponse chat(ChatRequest req) {
        String model = req.model() != null ? req.model() : defaultModel;
        StringJoiner system = new StringJoiner("\n\n");
        List<Object> messages = new ArrayList<>();
        for (ChatMessage m : req.messages()) {
            switch (m.role()) {
                case "system" -> system.add(m.content());
                case "tool" -> messages.add(Map.of("role", "user", "content",
                        List.of(Map.of("type", "tool_result", "tool_use_id", m.toolCallId(), "content", m.content()))));
                case "assistant" -> {
                    if (m.toolCalls().isEmpty()) {
                        messages.add(Map.of("role", "assistant", "content", m.content()));
                    } else {
                        List<Object> blocks = new ArrayList<>();
                        if (!m.content().isEmpty()) blocks.add(Map.of("type", "text", "text", m.content()));
                        for (ToolCall c : m.toolCalls()) {
                            blocks.add(Map.of("type", "tool_use", "id", c.id(), "name", c.name(), "input", c.arguments()));
                        }
                        messages.add(Map.of("role", "assistant", "content", blocks));
                    }
                }
                default -> messages.add(Map.of("role", m.role(), "content", m.content()));
            }
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("max_tokens", req.maxTokens() != null ? req.maxTokens() : 4096);
        body.put("messages", messages);
        if (system.length() > 0) body.put("system", system.toString());
        body.put("temperature", req.temperature());
        if (!req.tools().isEmpty()) {
            List<Object> tools = new ArrayList<>();
            for (ToolSpec t : req.tools()) {
                tools.add(Map.of("name", t.name(), "description", t.description(), "input_schema", t.parameters()));
            }
            body.put("tools", tools);
        }
        Map<String, Object> data = HttpJson.post(name(), baseUrl + "/v1/messages", body,
                Map.of("x-api-key", apiKey, "anthropic-version", "2023-06-01"), timeout);

        StringBuilder text = new StringBuilder();
        List<ToolCall> calls = new ArrayList<>();
        for (Object o : Json.arr(data.get("content"))) {
            Map<String, Object> b = Json.obj(o);
            String type = Json.str(b.get("type"), "");
            if (type.equals("text")) text.append(Json.str(b.get("text"), ""));
            if (type.equals("tool_use")) {
                calls.add(new ToolCall(Json.str(b.get("id"), ""), Json.str(b.get("name"), ""), Json.obj(b.get("input"))));
            }
        }
        Map<String, Object> usage = Json.obj(data.get("usage"));
        return new ChatResponse(text.toString(), calls, Json.str(data.get("model"), model), name(),
                new Usage(Json.integer(usage.get("input_tokens")), Json.integer(usage.get("output_tokens"))));
    }
}
