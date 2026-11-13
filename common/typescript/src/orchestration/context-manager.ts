import { ChatMessage } from "../models/types";

export interface ContextSnippet {
  /** Where it came from: file path, RAG hit id, doc URL... */
  source: string;
  text: string;
}

/**
 * Keeps the system prompt, extra context (open files, RAG results) and the conversation,
 * and trims the oldest turns so the prompt stays within a character budget.
 */
export class ContextManager {
  private readonly history: ChatMessage[] = [];
  private snippets: ContextSnippet[] = [];

  constructor(private systemPrompt = "You are a helpful software engineering assistant.", private readonly maxChars = 48_000) {}

  setSystemPrompt(prompt: string): void { this.systemPrompt = prompt; }
  addSnippet(snippet: ContextSnippet): void { this.snippets.push(snippet); }
  clearSnippets(): void { this.snippets = []; }
  add(message: ChatMessage): void { this.history.push(message); }
  addUser(content: string): void { this.add({ role: "user", content }); }
  addAssistant(content: string, toolCalls?: ChatMessage["toolCalls"]): void { this.add({ role: "assistant", content, toolCalls }); }
  addToolResult(toolCallId: string, name: string, content: string): void { this.add({ role: "tool", toolCallId, name, content }); }
  getHistory(): readonly ChatMessage[] { return this.history; }

  /** Messages ready to send to a model. */
  build(): ChatMessage[] {
    let system = this.systemPrompt;
    if (this.snippets.length) {
      system += "\n\n# Context\n" + this.snippets.map((s) => `## ${s.source}\n${s.text}`).join("\n\n");
    }
    const budget = Math.max(0, this.maxChars - system.length);
    const kept: ChatMessage[] = [];
    let used = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const m = this.history[i];
      used += m.content.length + JSON.stringify(m.toolCalls ?? []).length;
      if (used > budget && kept.length) break;
      kept.unshift(m);
    }
    // Never start with a tool result whose matching tool call was trimmed away.
    while (kept.length && kept[0].role === "tool") kept.shift();
    return [{ role: "system", content: system }, ...kept];
  }
}
