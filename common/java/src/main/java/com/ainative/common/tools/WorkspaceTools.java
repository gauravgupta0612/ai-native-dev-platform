package com.ainative.common.tools;

import com.ainative.common.model.ToolSpec;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Safe file tools confined to one workspace folder: read_file, list_files, search_text and (optionally) write_file.
 * Blocks path traversal (../), absolute paths outside the root, symlink escapes and secret files (.env, keys...).
 */
public final class WorkspaceTools {
    public static final List<Pattern> DEFAULT_DENIED = Stream.of(
            "^\\.env(\\..*)?$", "\\.pem$", "\\.key$", "\\.p12$", "\\.pfx$", "\\.jks$", "\\.keystore$",
            "^id_(rsa|dsa|ecdsa|ed25519)(\\.pub)?$", "^\\.npmrc$", "^\\.pypirc$", "^\\.netrc$", "^\\.git-credentials$",
            "^credentials(\\.json)?$", "^secrets?\\.(json|ya?ml|txt)$", "^\\.git$", "^\\.ssh$", "^\\.aws$", "^node_modules$", "^target$")
            .map(p -> Pattern.compile(p, Pattern.CASE_INSENSITIVE)).toList();

    private final Path base;
    private final long maxFileBytes;
    private final int maxEntries;
    private final List<Pattern> denied;

    private WorkspaceTools(Path root, long maxFileBytes, int maxEntries, List<String> extraDenied) throws IOException {
        this.base = root.toRealPath();
        this.maxFileBytes = maxFileBytes;
        this.maxEntries = maxEntries;
        List<Pattern> d = new ArrayList<>(DEFAULT_DENIED);
        for (String p : extraDenied) d.add(Pattern.compile(p, Pattern.CASE_INSENSITIVE));
        this.denied = List.copyOf(d);
    }

    /** Read-only tools (read_file, list_files, search_text). */
    public static List<ToolRegistry.ToolDefinition> create(Path root) throws IOException {
        return create(root, false, 1_000_000, 500, List.of());
    }

    /** All options. write_file is added only when allowWrite is true and always needs approval. */
    public static List<ToolRegistry.ToolDefinition> create(Path root, boolean allowWrite, long maxFileBytes, int maxEntries,
                                                         List<String> extraDenied) throws IOException {
        WorkspaceTools w = new WorkspaceTools(root, maxFileBytes, maxEntries, extraDenied);
        List<ToolRegistry.ToolDefinition> out = new ArrayList<>();
        out.add(new ToolRegistry.ToolDefinition(new ToolSpec("read_file",
                "Read a UTF-8 text file from the workspace. Optional 1-based start_line/end_line.",
                Map.of("type", "object",
                        "properties", Map.of("path", Map.of("type", "string", "minLength", 1),
                                "start_line", Map.of("type", "integer", "minimum", 1),
                                "end_line", Map.of("type", "integer", "minimum", 1)),
                        "required", List.of("path"), "additionalProperties", false)), w::readFile, false));
        out.add(new ToolRegistry.ToolDefinition(new ToolSpec("list_files",
                "List files and folders in the workspace (folders end with /).",
                Map.of("type", "object",
                        "properties", Map.of("path", Map.of("type", "string"), "depth", Map.of("type", "integer", "minimum", 0, "maximum", 10)),
                        "additionalProperties", false)), w::listFiles, false));
        out.add(new ToolRegistry.ToolDefinition(new ToolSpec("search_text",
                "Find lines containing a text (case-insensitive) in workspace files.",
                Map.of("type", "object",
                        "properties", Map.of("query", Map.of("type", "string", "minLength", 1, "maxLength", 200),
                                "path", Map.of("type", "string"),
                                "max_results", Map.of("type", "integer", "minimum", 1, "maximum", 500)),
                        "required", List.of("query"), "additionalProperties", false)), w::searchText, false));
        if (allowWrite) {
            out.add(new ToolRegistry.ToolDefinition(new ToolSpec("write_file",
                    "Create or overwrite a UTF-8 text file in the workspace (needs user approval).",
                    Map.of("type", "object",
                            "properties", Map.of("path", Map.of("type", "string", "minLength", 1),
                                    "content", Map.of("type", "string", "maxLength", maxFileBytes)),
                            "required", List.of("path", "content"), "additionalProperties", false)), w::writeFile, true));
        }
        return out;
    }

    // ---------- path safety ----------
    private boolean isDeniedName(String name) { return denied.stream().anyMatch(p -> p.matcher(name).find()); }

    private boolean inside(Path p) { return p.startsWith(base); }

    private Path resolveSafe(Object userPath, boolean mustExist) throws IOException {
        if (!(userPath instanceof String s) || s.isBlank()) throw new IllegalArgumentException("path is required");
        if (s.indexOf('\0') >= 0) throw new IllegalArgumentException("invalid path");
        Path abs;
        try {
            abs = base.resolve(s).normalize();
        } catch (InvalidPathException e) {
            throw new IllegalArgumentException("invalid path");
        }
        if (!inside(abs)) throw new IllegalArgumentException("path is outside the workspace");
        for (Path part : base.relativize(abs)) {
            if (!part.toString().isEmpty() && isDeniedName(part.toString())) throw new IllegalArgumentException("access to this file is not allowed");
        }
        if (Files.exists(abs)) {
            if (!inside(abs.toRealPath())) throw new IllegalArgumentException("path is outside the workspace (symlink)");
        } else {
            if (mustExist) throw new IllegalArgumentException("file not found");
            Path parent = abs.getParent();
            while (parent != null && !Files.exists(parent)) parent = parent.getParent();
            if (parent == null || !inside(parent.toRealPath())) throw new IllegalArgumentException("path is outside the workspace (symlink)");
        }
        return abs;
    }

    private String readText(Path p) throws IOException {
        if (!Files.isRegularFile(p)) throw new IllegalArgumentException("not a file");
        long size = Files.size(p);
        if (size > maxFileBytes) throw new IllegalArgumentException("file too large (" + size + " bytes, limit " + maxFileBytes + ")");
        byte[] data = Files.readAllBytes(p);
        for (byte b : data) if (b == 0) throw new IllegalArgumentException("binary file");
        return new String(data, StandardCharsets.UTF_8);
    }

    private void walk(Path dir, int depth, List<Path> out, int limit) throws IOException {
        if (depth < 0 || out.size() >= limit) return;
        List<Path> entries;
        try (Stream<Path> s = Files.list(dir)) {
            entries = s.sorted().toList();
        }
        for (Path e : entries) {
            if (out.size() >= limit) return;
            if (isDeniedName(e.getFileName().toString()) || Files.isSymbolicLink(e)) continue;
            out.add(e);
            if (Files.isDirectory(e)) walk(e, depth - 1, out, limit);
        }
    }

    private String rel(Path p) {
        String r = base.relativize(p).toString().replace('\\', '/');
        return Files.isDirectory(p) ? r + "/" : r;
    }

    private static int intArg(Map<String, Object> a, String key, int def) {
        return a.get(key) instanceof Number n ? n.intValue() : def;
    }

    // ---------- tools ----------
    private Object readFile(Map<String, Object> a) throws IOException {
        String text = readText(resolveSafe(a.get("path"), true));
        if (!a.containsKey("start_line") && !a.containsKey("end_line")) return text;
        String[] lines = text.split("\\r?\\n", -1);
        int start = intArg(a, "start_line", 1);
        int end = Math.min(intArg(a, "end_line", lines.length), lines.length);
        StringBuilder sb = new StringBuilder();
        for (int i = start; i <= end; i++) sb.append(i).append(": ").append(lines[i - 1]).append('\n');
        return sb.toString();
    }

    private Object listFiles(Map<String, Object> a) throws IOException {
        Path dir = a.get("path") != null ? resolveSafe(a.get("path"), true) : base;
        if (!Files.isDirectory(dir)) throw new IllegalArgumentException("not a folder");
        List<Path> found = new ArrayList<>();
        walk(dir, intArg(a, "depth", 2), found, maxEntries + 1);
        StringJoiner sj = new StringJoiner("\n");
        for (int i = 0; i < Math.min(found.size(), maxEntries); i++) sj.add(rel(found.get(i)));
        if (found.size() > maxEntries) sj.add("…(limit " + maxEntries + " reached)");
        return sj.toString();
    }

    private Object searchText(Map<String, Object> a) throws IOException {
        Path dir = a.get("path") != null ? resolveSafe(a.get("path"), true) : base;
        String needle = String.valueOf(a.get("query")).toLowerCase(Locale.ROOT);
        int limit = intArg(a, "max_results", 100);
        List<Path> files = new ArrayList<>();
        walk(dir, 20, files, 20_000);
        List<String> hits = new ArrayList<>();
        for (Path f : files) {
            if (Files.isDirectory(f)) continue;
            String text;
            try {
                text = readText(f);
            } catch (IllegalArgumentException | IOException e) {
                continue;
            }
            String[] lines = text.split("\\r?\\n");
            for (int i = 0; i < lines.length && hits.size() < limit; i++) {
                if (lines[i].toLowerCase(Locale.ROOT).contains(needle)) {
                    String line = lines[i].trim();
                    hits.add(rel(f) + ":" + (i + 1) + ": " + line.substring(0, Math.min(300, line.length())));
                }
            }
            if (hits.size() >= limit) break;
        }
        return hits.isEmpty() ? "No matches." : String.join("\n", hits);
    }

    private Object writeFile(Map<String, Object> a) throws IOException {
        Path p = resolveSafe(a.get("path"), false);
        Files.createDirectories(p.getParent());
        String content = String.valueOf(a.get("content"));
        Files.writeString(p, content, StandardCharsets.UTF_8);
        return "Wrote " + content.getBytes(StandardCharsets.UTF_8).length + " bytes to " + rel(p);
    }
}
