import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ChatRequest, ChatResponse, Logger, ModelProvider } from "../common/typescript/src";

Logger.sink = () => {};

export function tempDir(prefix = "aip-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function write(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** Fake model that replays responses (offline tests). */
export class ScriptedProvider implements ModelProvider {
  readonly requests: ChatRequest[] = [];
  constructor(readonly name: string, private readonly script: Array<Partial<ChatResponse>>) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const next = this.script.shift() ?? { content: "done" };
    return { content: "", toolCalls: [], model: "fake", provider: this.name, usage: { inputTokens: 10, outputTokens: 5 }, ...next };
  }
}
