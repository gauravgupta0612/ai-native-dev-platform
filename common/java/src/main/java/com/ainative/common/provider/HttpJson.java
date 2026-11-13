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
    // Redirects are never followed, so API keys cannot be forwarded to another host.
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private static final java.util.Set<String> LOCAL_HOSTS = java.util.Set.of("localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal");

    private HttpJson() {}

    /** Only HTTPS is allowed, except for local endpoints (Ollama, LM Studio, tests). */
    public static void assertSecureUrl(String provider, String url) {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException e) {
            throw new ProviderException(provider, "Invalid URL", 0);
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if (scheme.equals("https") && !host.isEmpty()) return;
        if (scheme.equals("http") && LOCAL_HOSTS.contains(host)) return;
        throw new ProviderException(provider, "Insecure URL refused (use https): " + scheme + "://" + host, 0);
    }

    public static Map<String, Object> post(String provider, String url, Object body, Map<String, String> headers, Duration timeout) {
        assertSecureUrl(provider, url);
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(Json.stringify(body)));
        headers.forEach(b::header);
        try {
            HttpResponse<String> res = CLIENT.send(b.build(), HttpResponse.BodyHandlers.ofString());
            String text = res.body() == null ? "" : res.body();
            if (res.statusCode() >= 300) {
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
