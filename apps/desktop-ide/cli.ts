#!/usr/bin/env node
import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { Logger } from "../../common/typescript/src";
import { analyzeProject } from "../../features/project-analysis";
import { WORKFLOWS, WorkflowEngine } from "../../features/multi-agent-workflows";
import { TestAssistant } from "../../features/debug-and-test";
import { CommandSandbox } from "../../security/sandbox";
import { integrityReport } from "../../security/audit-log";
import { Telemetry } from "../../ai-orchestration/observability";
import { createPlatform } from "./platform";
import * as path from "node:path";

const HELP = `
Commands
  ask <question>          Ask about the code (reader agent)
  review <what>           Review code or changes (reviewer agent)
  code <task>             Implement a change (coder agent; writes need your approval)
  flow <name> <input>     Run a multi-agent workflow (${Object.keys(WORKFLOWS).join(", ")})
  index                   Build the code index and knowledge graph
  analyze                 Project statistics and findings
  test                    Run the project's tests and explain failures
  open <file>             Add a file to the AI context
  providers               Model providers and their health
  audit                   Check the audit log integrity
  help | quit
`;

/** Line reader that works both interactively and with piped input (scripts, CI). */
class Lines {
  private readonly queue: string[] = [];
  private readonly waiters: Array<(l: string | null) => void> = [];
  private closed = false;
  constructor() {
    const rl = readline.createInterface({ input, terminal: false });
    rl.on("line", (l) => (this.waiters.length ? this.waiters.shift()!(l) : this.queue.push(l)));
    rl.on("close", () => { this.closed = true; this.waiters.splice(0).forEach((w) => w(null)); });
  }
  question(prompt: string): Promise<string | null> {
    output.write(prompt);
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((r) => this.waiters.push(r));
  }
}

async function main() {
  Logger.sink = () => {}; // keep the console clean; set LOG_LEVEL and remove this line to debug
  const root = path.resolve(process.argv[2] ?? ".");
  const rl = new Lines();
  const platform = await createPlatform({
    projectRoot: root,
    vaultPassword: process.env.AI_PLATFORM_VAULT_PASSWORD,
    prompt: async (subject, permission, detail) => {
      const a = ((await rl.question(`\n⚠  ${subject} wants ${permission} (${detail})\n   [o]nce / [a]lways / [N]o: `)) ?? "").trim().toLowerCase();
      return a === "a" ? "allow-always" : a === "o" ? "allow-once" : "deny";
    },
  });

  console.log(`AI-Native Developer Platform — project "${platform.project.name}" (${platform.project.kind})`);
  console.log(`Providers: ${platform.routerInfo.providers.join(", ")}${platform.routerInfo.skipped.length ? `  (skipped: ${platform.routerInfo.skipped.map((s) => s.split(":")[0]).join(", ")})` : ""}`);
  console.log(`Policy: file writes ${platform.policy.allowFileWrites ? "allowed (with approval)" : "off"}, local only ${platform.policy.localOnly}. Type "help".`);

  const roleCmd: Record<string, "reader" | "reviewer" | "coder"> = { ask: "reader", review: "reviewer", code: "coder" };
  for (;;) {
    const raw = await rl.question("\n> ");
    if (raw === null) break;
    const line = raw.trim();
    if (!line) continue;
    const [cmd, ...rest] = line.split(" ");
    const arg = rest.join(" ");
    try {
      if (cmd === "quit" || cmd === "exit") break;
      else if (cmd === "help") console.log(HELP);
      else if (roleCmd[cmd]) {
        const r = await platform.agents.ask(roleCmd[cmd], arg, platform.project);
        console.log(`\n${r.output}\n\n[${r.stoppedReason} · ${r.steps} steps · ${r.toolCalls} tools · ${r.usage.inputTokens + r.usage.outputTokens} tokens${r.routedLocal ? " · local model" : ""}]`);
      } else if (cmd === "flow") {
        const [name, ...q] = rest;
        const wf = WORKFLOWS[name];
        if (!wf) { console.log(`Unknown workflow. Available: ${Object.keys(WORKFLOWS).join(", ")}`); continue; }
        const run = await new WorkflowEngine(platform.agents).run(wf, q.join(" "), (id, r) => console.log(`\n── ${id} (${r.stoppedReason}) ──\n${r.output}`));
        console.log(`\nWorkflow ${run.completed ? "completed" : "stopped"}${run.skipped.length ? `; skipped: ${run.skipped.join(", ")}` : ""}`);
      } else if (cmd === "index") {
        const r = await platform.reindex();
        console.log(`Indexed ${r.files} files into ${r.chunks} chunks; ${platform.codeIndex.allSymbols().length} symbols.`);
      } else if (cmd === "analyze") {
        const rep = analyzeProject(platform.project.root, platform.workspace.index());
        console.log(JSON.stringify({ files: rep.totalFiles, lines: rep.totalLines, byLanguage: rep.byLanguage, todo: rep.todoCount, findings: rep.findings }, null, 2));
      } else if (cmd === "test") {
        if (!(await platform.permissions.request("cli", "command:test", platform.project.root, "run the project's test command"))) { console.log("Cancelled."); continue; }
        const sandbox = new CommandSandbox({ allowedCommands: platform.policy.allowedCommands, workspaceRoot: platform.project.root, timeoutMs: 10 * 60_000 });
        const rep = await new TestAssistant(sandbox, platform.project.root, platform.router).run(true);
        console.log(rep.passed ? "✔ Tests passed" : `✖ ${rep.failures.length} failure(s)\n${rep.analysis ?? ""}`);
      } else if (cmd === "open") {
        platform.workspace.openFile(arg);
        console.log(`Added ${arg} to the AI context.`);
      } else if (cmd === "providers") {
        console.table(Telemetry.providerSummary(platform.router.metrics));
        console.log(`Registered: ${platform.routerInfo.providers.join(", ")}`);
      } else if (cmd === "audit") {
        console.log(integrityReport(path.join(platform.project.root, ".aiplatform", "audit.jsonl")));
      } else console.log(`Unknown command "${cmd}". Type "help".`);
    } catch (e) {
      console.log(`Error: ${(e as Error).message}`);
    }
  }
  platform.dispose();
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
