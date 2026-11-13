package com.ainative.common.provider;

import com.ainative.common.json.Json;
import com.ainative.common.model.*;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

/** Google Gemini generateContent adapter (text chat). Use OpenAI/Anthropic for native tool calling. */
public class GeminiProvider implements ModelProvider {
    private final String apiKey;
    private final String defaultModel;
    private final String baseUrl;
    private final Duration timeout;

    public GeminiProvider(String apiKey, String defaultModel) {
        this(apiKey, defaultModel, "https://generativelanguage.googleapis.com/v1beta", Duration.ofSeconds(60));
    }

    public GeminiProvider(String apiKey, String defaultModel, String baseUrl, Duration timeout) {
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.timeout = timeout;
    }

    @Override
    public String name() { return "gemini"; }

    @Override
    public ChatResponse chat(ChatRequest req) {
        String model = req.model() != null ? req.model() : defaultModel;
        StringJoiner system = new StringJoiner("\n\n");
        List<Object> contents = new ArrayList<>();
        for (ChatMessage m : req.messages()) {
            if (m.role().equals("system")) { system.add(m.content()); continue; }
            String text = m.role().equals("tool")
                    ? "Tool result (" + (m.name() != null ? m.name() : m.toolCallId()) + "): " + m.content()
                    : m.content();
            contents.add(Map.of("role", m.role().equals("assistant") ? "model" : "user", "parts", List.of(Map.of("text", text))));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("contents", contents);
        if (system.length() > 0) body.put("systemInstruction", Map.of("parts", List.of(Map.of("text", system.toString()))));
        Map<String, Object> gen = new LinkedHashMap<>();
        if (req.temperature() != null) gen.put("temperature", req.temperature());
        if (req.maxTokens() != null) gen.put("maxOutputTokens", req.maxTokens());
        if (!gen.isEmpty()) body.put("generationConfig", gen);

        String url = baseUrl + "/models/" + URLEncoder.encode(model, StandardCharsets.UTF_8) + ":generateContent";
        Map<String, Object> data = HttpJson.post(name(), url, body, Map.of("x-goog-api-key", apiKey), timeout);
        List<Object> candidates = Json.arr(data.get("candidates"));
        Map<String, Object> content = Json.obj(candidates.isEmpty() ? null : Json.obj(candidates.get(0)).get("content"));
        StringBuilder text = new StringBuilder();
        for (Object p : Json.arr(content.get("parts"))) text.append(Json.str(Json.obj(p).get("text"), ""));
        Map<String, Object> meta = Json.obj(data.get("usageMetadata"));
        return new ChatResponse(text.toString(), List.of(), model, name(),
                new Usage(Json.integer(meta.get("promptTokenCount")), Json.integer(meta.get("candidatesTokenCount"))));
    }
}
