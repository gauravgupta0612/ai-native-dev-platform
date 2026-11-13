package com.ainative.common.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/** All settings come from environment variables (or a local .env file). Never hard-code keys. */
public record PlatformConfig(
        String defaultProvider,
        Provider openai,
        Provider anthropic,
        Provider gemini,
        Provider ollama,
        Provider custom,
        String auditLogPath,
        int maxAgentSteps) {

    /** Settings for one provider. {@code enabled} is used by providers without a key (Ollama). */
    public record Provider(String apiKey, String baseUrl, String model, boolean enabled) {
        public boolean hasKey() { return apiKey != null && !apiKey.isBlank(); }
    }

    /** Reads System.getenv() plus a .env file in the working directory (real env vars win). */
    public static PlatformConfig load() {
        Map<String, String> env = new HashMap<>(loadDotEnv(Path.of(".env")));
        env.putAll(System.getenv());
        return from(env);
    }

    public static PlatformConfig from(Map<String, String> env) {
        return new PlatformConfig(
                v(env, "DEFAULT_PROVIDER", "auto"),
                new Provider(v(env, "OPENAI_API_KEY", null), v(env, "OPENAI_BASE_URL", "https://api.openai.com/v1"), v(env, "OPENAI_MODEL", "gpt-4o-mini"), true),
                new Provider(v(env, "ANTHROPIC_API_KEY", null), v(env, "ANTHROPIC_BASE_URL", "https://api.anthropic.com"), v(env, "ANTHROPIC_MODEL", "claude-sonnet-4-5"), true),
                new Provider(v(env, "GEMINI_API_KEY", null), v(env, "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"), v(env, "GEMINI_MODEL", "gemini-2.5-flash"), true),
                new Provider(null, v(env, "OLLAMA_BASE_URL", "http://localhost:11434"), v(env, "OLLAMA_MODEL", "llama3.1"),
                        "true".equalsIgnoreCase(v(env, "OLLAMA_ENABLED", "false"))),
                new Provider(v(env, "CUSTOM_API_KEY", null), v(env, "CUSTOM_API_URL", null), v(env, "CUSTOM_MODEL", "default"), true),
                v(env, "AUDIT_LOG_PATH", null),
                Integer.parseInt(v(env, "MAX_AGENT_STEPS", "8")));
    }

    /** Parses KEY=VALUE lines; ignores blanks and # comments; strips matching quotes. */
    public static Map<String, String> loadDotEnv(Path path) {
        Map<String, String> out = new HashMap<>();
        if (!Files.exists(path)) return out;
        try {
            for (String raw : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                String line = raw.trim();
                int eq = line.indexOf('=');
                if (line.isEmpty() || line.startsWith("#") || eq < 1) continue;
                String key = line.substring(0, eq).trim();
                String value = line.substring(eq + 1).trim();
                if (value.length() >= 2 && (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length() - 1);
                }
                out.put(key, value);
            }
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + path, e);
        }
        return out;
    }

    private static String v(Map<String, String> env, String key, String def) {
        String value = env.get(key);
        return value == null || value.isBlank() ? def : value.trim();
    }
}
