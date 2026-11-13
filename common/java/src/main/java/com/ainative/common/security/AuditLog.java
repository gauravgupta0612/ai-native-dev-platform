package com.ainative.common.security;

import com.ainative.common.json.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Append-only audit trail (JSON lines). Writes to a file if a path is given; keeps recent events in memory. */
public class AuditLog {
    public record Event(String ts, String actor, String action, Map<String, Object> details) {}

    private final Path file;
    private final int keepInMemory;
    private final Deque<Event> recent = new ArrayDeque<>();

    public AuditLog() { this(null, 1000); }

    public AuditLog(String filePath) { this(filePath, 1000); }

    public AuditLog(String filePath, int keepInMemory) {
        this.file = filePath == null ? null : Path.of(filePath);
        this.keepInMemory = keepInMemory;
        if (file != null && file.toAbsolutePath().getParent() != null) {
            try {
                Files.createDirectories(file.toAbsolutePath().getParent());
            } catch (IOException e) {
                throw new IllegalStateException("Cannot create audit log folder", e);
            }
        }
    }

    public synchronized Event record(String actor, String action, Map<String, ?> details) {
        Event e = new Event(Instant.now().toString(), actor, action, details == null ? Map.of() : new LinkedHashMap<>(details));
        recent.addLast(e);
        if (recent.size() > keepInMemory) recent.removeFirst();
        if (file != null) {
            Map<String, Object> line = new LinkedHashMap<>();
            line.put("ts", e.ts());
            line.put("actor", actor);
            line.put("action", action);
            line.put("details", e.details());
            try {
                Files.writeString(file, Json.stringify(line) + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } catch (IOException ex) {
                throw new IllegalStateException("Cannot write audit log", ex);
            }
        }
        return e;
    }

    public synchronized List<Event> events() { return List.copyOf(recent); }
}
