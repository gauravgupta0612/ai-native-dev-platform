package com.ainative.common.security;

import com.ainative.common.json.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.*;

/**
 * Tamper-evident, append-only audit trail (JSON lines, hash-chained).
 * Each event stores the previous event's hash; changing any past line breaks the chain.
 * Secrets in details are masked before writing. Use {@link #verifyFile(Path)} to check integrity.
 */
public class AuditLog {
    public record Event(String ts, String actor, String action, Map<String, Object> details, String prevHash, String hash) {}

    private static final String GENESIS = "";

    private final Path file;
    private final int keepInMemory;
    private final Deque<Event> recent = new ArrayDeque<>();
    private String lastHash = GENESIS;

    public AuditLog() { this(null, 1000); }

    public AuditLog(String filePath) { this(filePath, 1000); }

    public AuditLog(String filePath, int keepInMemory) {
        this.file = filePath == null ? null : Path.of(filePath);
        this.keepInMemory = keepInMemory;
        if (file == null) return;
        try {
            if (file.toAbsolutePath().getParent() != null) Files.createDirectories(file.toAbsolutePath().getParent());
            if (Files.exists(file)) {
                List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8).stream().filter(l -> !l.isBlank()).toList();
                if (!lines.isEmpty()) lastHash = Json.str(Json.parseObject(lines.get(lines.size() - 1)).get("hash"), GENESIS);
            }
        } catch (IOException e) {
            throw new IllegalStateException("Cannot open audit log", e);
        }
    }

    public synchronized Event record(String actor, String action, Map<String, ?> details) {
        // mask secrets, then canonicalise (sorted keys) so the hash is stable when re-read from disk
        Object safe = Json.parse(PolicyGuardrails.redactSecrets(Json.stringify(details == null ? Map.of() : details), false));
        Map<String, Object> canon = Json.obj(canonical(safe));
        String ts = Instant.now().toString();
        Event e = new Event(ts, actor, action, canon, lastHash, hash(lastHash, ts, actor, action, canon));
        lastHash = e.hash();
        recent.addLast(e);
        if (recent.size() > keepInMemory) recent.removeFirst();
        if (file != null) {
            Map<String, Object> line = new LinkedHashMap<>();
            line.put("ts", e.ts());
            line.put("actor", actor);
            line.put("action", action);
            line.put("details", canon);
            line.put("prevHash", e.prevHash());
            line.put("hash", e.hash());
            try {
                Files.writeString(file, Json.stringify(line) + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } catch (IOException ex) {
                throw new IllegalStateException("Cannot write audit log", ex);
            }
        }
        return e;
    }

    public synchronized List<Event> events() { return List.copyOf(recent); }

    /** Returns the index of the first broken event, or -1 if the chain is intact. */
    public static int verify(List<Event> events) {
        for (int i = 0; i < events.size(); i++) {
            Event e = events.get(i);
            if (i > 0 && !e.prevHash().equals(events.get(i - 1).hash())) return i;
            if (!hash(e.prevHash(), e.ts(), e.actor(), e.action(), e.details()).equals(e.hash())) return i;
        }
        return -1;
    }

    /** Verifies a whole audit file. Returns -1 if intact, otherwise the 0-based line that was altered. */
    public static int verifyFile(Path path) throws IOException {
        List<Event> events = new ArrayList<>();
        for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
            if (line.isBlank()) continue;
            Map<String, Object> m = Json.parseObject(line);
            events.add(new Event(Json.str(m.get("ts"), ""), Json.str(m.get("actor"), ""), Json.str(m.get("action"), ""),
                    Json.obj(canonical(m.get("details"))), Json.str(m.get("prevHash"), ""), Json.str(m.get("hash"), "")));
        }
        if (!events.isEmpty() && !events.get(0).prevHash().equals(GENESIS)) return 0;
        return verify(events);
    }

    private static Object canonical(Object v) {
        if (v instanceof Map<?, ?> m) {
            TreeMap<String, Object> t = new TreeMap<>();
            m.forEach((k, val) -> t.put(String.valueOf(k), canonical(val)));
            return t;
        }
        if (v instanceof List<?> l) return l.stream().map(AuditLog::canonical).toList();
        return v;
    }

    private static String hash(String prev, String ts, String actor, String action, Map<String, Object> details) {
        String payload = prev + "|" + ts + "|" + actor + "|" + action + "|" + Json.stringify(canonical(details));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
