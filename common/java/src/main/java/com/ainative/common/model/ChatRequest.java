package com.ainative.common.model;

import java.util.List;

/** Provider-neutral chat request. Null fields mean "use the provider default". */
public record ChatRequest(List<ChatMessage> messages, String model, List<ToolSpec> tools, Double temperature, Integer maxTokens) {
    public ChatRequest {
        messages = List.copyOf(messages);
        tools = tools == null ? List.of() : List.copyOf(tools);
    }

    public static ChatRequest of(List<ChatMessage> messages) { return new ChatRequest(messages, null, null, null, null); }

    public ChatRequest withModel(String m) { return new ChatRequest(messages, m, tools, temperature, maxTokens); }
    public ChatRequest withTools(List<ToolSpec> t) { return new ChatRequest(messages, model, t, temperature, maxTokens); }
    public ChatRequest withTemperature(Double t) { return new ChatRequest(messages, model, tools, t, maxTokens); }
    public ChatRequest withMaxTokens(Integer n) { return new ChatRequest(messages, model, tools, temperature, n); }
}
