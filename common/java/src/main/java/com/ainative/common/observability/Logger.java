package com.ainative.common.observability;

import com.ainative.common.json.Json;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

/** Structured JSON-line logger. Level from LOG_LEVEL env (default INFO). */
public class Logger {
    public enum Level { DEBUG, INFO, WARN, ERROR }

    /** Where log lines go. Replace in tests or to forward to your logging framework. */
    public static volatile Consumer<String> sink = System.err::println;

    private final String component;
    private final Level level;

    public Logger(String component) {
        this(component, levelFromEnv());
    }

    public Logger(String component, Level level) {
        this.component = component;
        this.level = level;
    }

    private static Level levelFromEnv() {
        String env = System.getenv("LOG_LEVEL");
        try {
            return env == null ? Level.INFO : Level.valueOf(env.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return Level.INFO;
        }
    }

    public Logger child(String name) { return new Logger(component + "." + name, level); }

    public void debug(String msg, Map<String, ?> data) { log(Level.DEBUG, msg, data); }
    public void info(String msg, Map<String, ?> data) { log(Level.INFO, msg, data); }
    public void warn(String msg, Map<String, ?> data) { log(Level.WARN, msg, data); }
    public void error(String msg, Map<String, ?> data) { log(Level.ERROR, msg, data); }
    public void info(String msg) { log(Level.INFO, msg, Map.of()); }

    private void log(Level l, String msg, Map<String, ?> data) {
        if (l.ordinal() < level.ordinal()) return;
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("ts", Instant.now().toString());
        line.put("level", l.name().toLowerCase());
        line.put("component", component);
        line.put("msg", msg);
        if (data != null) line.putAll(data);
        sink.accept(Json.stringify(line));
    }
}
