package com.ainative.common.provider;

import com.ainative.common.json.Json;
import com.ainative.common.model.ProviderException;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/** Small JSON POST helper (java.net.http), shared by all HTTP providers. */
public final class HttpJson {
    private static final HttpClient CLIENT = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    private HttpJson() {}

    public static Map<String, Object> post(String provider, String url, Object body, Map<String, String> headers, Duration timeout) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(Json.stringify(body)));
        headers.forEach(b::header);
        try {
            HttpResponse<String> res = CLIENT.send(b.build(), HttpResponse.BodyHandlers.ofString());
            String text = res.body() == null ? "" : res.body();
            if (res.statusCode() >= 400) {
                throw new ProviderException(provider, "HTTP " + res.statusCode() + ": " + text.substring(0, Math.min(500, text.length())), res.statusCode());
            }
            return text.isBlank() ? Map.of() : Json.parseObject(text);
        } catch (IOException e) {
            throw new ProviderException(provider, e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ProviderException(provider, "interrupted", e);
        }
    }

    /** Tool arguments may arrive as a JSON string or an object. */
    public static Map<String, Object> parseArgs(Object raw) {
        if (raw instanceof Map) return Json.obj(raw);
        if (raw instanceof String s && !s.isBlank()) {
            try {
                return Json.parseObject(s);
            } catch (IllegalArgumentException e) {
                return Map.of("_raw", s);
            }
        }
        return Map.of();
    }
}
