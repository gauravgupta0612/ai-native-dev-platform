package com.ainative.common.provider;

import com.ainative.common.model.*;

import java.util.List;

/** Offline provider for tests, demos and CI — no network, no API key. */
public class EchoProvider implements ModelProvider {
    @Override
    public String name() { return "echo"; }

    @Override
    public ChatResponse chat(ChatRequest req) {
        String lastUser = "";
        int total = 0;
        for (ChatMessage m : req.messages()) {
            total += m.content().length();
            if (m.role().equals("user")) lastUser = m.content();
        }
        String content = "Echo: " + lastUser;
        return new ChatResponse(content, List.of(), req.model() != null ? req.model() : "echo-1", name(),
                new Usage((total + 3) / 4, (content.length() + 3) / 4));
    }
}
