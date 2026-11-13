package com.ainative.common.model;

import java.util.List;

/**
 * One message in a conversation. Role is "system", "user", "assistant" or "tool".
 * Assistant messages may carry tool calls; tool messages carry the toolCallId they answer.
 */
public record ChatMessage(String role, String content, List<ToolCall> toolCalls, String toolCallId, String name) {
    public ChatMessage {
        content = content == null ? "" : content;
        toolCalls = toolCalls == null ? List.of() : List.copyOf(toolCalls);
    }

    public static ChatMessage system(String content) { return new ChatMessage("system", content, null, null, null); }
    public static ChatMessage user(String content) { return new ChatMessage("user", content, null, null, null); }
    public static ChatMessage assistant(String content) { return new ChatMessage("assistant", content, null, null, null); }
    public static ChatMessage assistant(String content, List<ToolCall> calls) { return new ChatMessage("assistant", content, calls, null, null); }
    public static ChatMessage tool(String toolCallId, String name, String content) { return new ChatMessage("tool", content, null, toolCallId, name); }
}
