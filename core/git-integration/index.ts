import { execFile } from "node:child_process";
import { ToolDefinition } from "../../common/typescript/src";

export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

const SAFE_REF = /^[A-Za-z0-9._\/-]{1,200}$/;

/** Git operations through the git CLI (no shell, fixed argument lists, input validated). */
export class GitService {
  constructor(private readonly repoDir: string, private readonly timeoutMs = 30_000) {}

  private git(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("git", ["-c", "core.quotepath=off", ...args], { cwd: this.repoDir, timeout: this.timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout)));
    });
  }

  async isRepo(): Promise<boolean> {
    try { return (await this.git(["rev-parse", "--is-inside-work-tree"])).trim() === "true"; } catch { return false; }
  }

  async currentBranch(): Promise<string> {
    return (await this.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  }

  async status(): Promise<GitStatusEntry[]> {
    const out = await this.git(["status", "--porcelain=v1"]);
    return out.split("\n").filter(Boolean).map((l) => ({ index: l[0], worktree: l[1], path: l.slice(3) }));
  }

  async diff(staged = false, file?: string): Promise<string> {
    const args = ["diff", "--no-color"];
    if (staged) args.push("--cached");
    if (file) args.push("--", file);
    return this.git(args);
  }

  async log(limit = 20): Promise<GitCommit[]> {
    const n = Math.max(1, Math.min(500, Math.floor(limit)));
    const out = await this.git(["log", `-n${n}`, "--pretty=format:%H%x1f%an%x1f%aI%x1f%s"]);
    return out.split("\n").filter(Boolean).map((l) => {
      const [hash, author, date, subject] = l.split("\x1f");
      return { hash, author, date, subject };
    });
  }

  async branches(): Promise<string[]> {
    return (await this.git(["branch", "--format=%(refname:short)"])).split("\n").filter(Boolean);
  }

  async createBranch(name: string): Promise<void> {
    if (!SAFE_REF.test(name) || name.startsWith("-") || name.includes("..")) throw new Error("Invalid branch name");
    await this.git(["checkout", "-b", name]);
  }

  async add(paths: string[]): Promise<void> {
    if (!paths.length) return;
    await this.git(["add", "--", ...paths]);
  }

  async commit(message: string, author?: { name: string; email: string }): Promise<string> {
    if (!message.trim()) throw new Error("Commit message is empty");
    const args = author ? ["-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`, "commit", "-m", message] : ["commit", "-m", message];
    await this.git(args);
    return (await this.git(["rev-parse", "HEAD"])).trim();
  }

  /** Read-only git tools for agents. Commits stay a human action (or add your own tool with requiresApproval). */
  tools(): ToolDefinition[] {
    return [
      {
        spec: { name: "git_status", description: "List changed files in the git repository.", parameters: { type: "object", properties: {}, additionalProperties: false } },
        handler: async () => this.status(),
      },
      {
        spec: {
          name: "git_diff",
          description: "Show the git diff (optionally staged, optionally one file).",
          parameters: { type: "object", properties: { staged: { type: "boolean" }, path: { type: "string" } }, additionalProperties: false },
        },
        handler: async ({ staged, path }) => this.diff(Boolean(staged), path ? String(path) : undefined),
      },
      {
        spec: {
          name: "git_log",
          description: "Recent commits (hash, author, date, subject).",
          parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
        },
        handler: async ({ limit }) => this.log(Number(limit ?? 20)),
      },
    ];
  }
}
