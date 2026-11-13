/** Entities stored in the project database. */

export interface ConversationRecord {
  id: string;
  projectRoot: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
}

export interface AgentRunRecord {
  id: string;
  conversationId?: string;
  agent: string;
  provider: string;
  stoppedReason: string;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
  durationMs: number;
}

export interface SettingRecord {
  id: string; // the setting key
  value: unknown;
}

export interface Tables {
  conversations: ConversationRecord;
  messages: MessageRecord;
  agentRuns: AgentRunRecord;
  settings: SettingRecord;
}
