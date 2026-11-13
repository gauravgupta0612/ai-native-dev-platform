package com.ainative.common.model;

/** Every AI model adapter (OpenAI, Claude, Gemini, Ollama, custom...) implements this one interface. */
public interface ModelProvider {
    String name();

    ChatResponse chat(ChatRequest request);
}
