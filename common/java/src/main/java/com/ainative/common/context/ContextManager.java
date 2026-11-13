package com.ainative.common.context;

import com.ainative.common.json.Json;
import com.ainative.common.model.ChatMessage;
import com.ainative.common.model.ToolCall;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedList;
import java.util.List;

/**
 * Keeps the system prompt, extra context (open files, RAG results) and the conversation,
 * and trims the oldest turns so the prompt stays within a character budget.
 */
public class ContextManager {
    /** A piece of extra context: where it came from and its text. */
    public record Snippet(String source, String text) {}

    private String systemPrompt;
    private final int maxChars;
    private final List<ChatMessage> history = new ArrayList<>();
    private final List<Snippet> snippets = new ArrayList<>();

    public ContextManager() { this("You are a helpful software engineering assistant.", 48_000); }

    public ContextManager(String systemPrompt, int maxChars) {
        this.systemPrompt = systemPrompt;
        this.maxChars = maxChars;
    }

    public void setSystemPrompt(String prompt) { this.systemPrompt = prompt; }
    public void addSnippet(String source, String text) { snippets.add(new Snippet(source, text)); }
    public void clearSnippets() { snippets.clear(); }
    public void add(ChatMessage m) { history.add(m); }
    public void addUser(String content) { add(ChatMessage.user(content)); }
    public void addAssistant(String content, List<ToolCall> calls) { add(ChatMessage.assistant(content, calls)); }
    public void addToolResult(String callId, String name, String content) { add(ChatMessage.tool(callId, name, content)); }
    public List<ChatMessage> history() { return Collections.unmodifiableList(history); }

    /** Messages ready to send to a model. */
    public List<ChatMessage> build() {
        StringBuilder system = new StringBuilder(systemPrompt);
        if (!snippets.isEmpty()) {
            system.append("\n\n# Context\n");
            for (int i = 0; i < snippets.size(); i++) {
                if (i > 0) system.append("\n\n");
                system.append("## ").append(snippets.get(i).source()).append('\n').append(snippets.get(i).text());
            }
        }
        int budget = Math.max(0, maxChars - system.length());
        LinkedList<ChatMessage> kept = new LinkedList<>();
        int used = 0;
        for (int i = history.size() - 1; i >= 0; i--) {
            ChatMessage m = history.get(i);
            used += m.content().length() + (m.toolCalls().isEmpty() ? 0 : Json.stringify(m.toolCalls().stream().map(ToolCall::arguments).toList()).length());
            if (used > budget && !kept.isEmpty()) break;
            kept.addFirst(m);
        }
        while (!kept.isEmpty() && kept.getFirst().role().equals("tool")) kept.removeFirst(); // no orphan tool results
        List<ChatMessage> out = new ArrayList<>();
        out.add(ChatMessage.system(system.toString()));
        out.addAll(kept);
        return out;
    }
}
