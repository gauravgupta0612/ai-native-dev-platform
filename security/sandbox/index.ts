import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { redactSecrets } from "../../common/typescript/src";

export interface SandboxPolicy {
  /** Executables that may run (base names, without .exe). */
  allowedCommands: string[];
  /** Arguments that are always refused, e.g. "--force", "rm -rf". Matched case-insensitively. */
  deniedArgs?: RegExp[];
  /** Folder the command must run in (and stay in). */
  workspaceRoot: string;
  /** Default 60 s. */
  timeoutMs?: number;
  /** Output kept per stream. Default 200 000 characters. */
  maxOutputChars?: number;
  /** Environment variables passed through; everything else (including secrets) is dropped. */
  envAllowList?: string[];
}

export interface RunResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

// No shell is used on Linux/macOS; on Windows .cmd/.bat tools (npm, mvn) need cmd.exe, so its special characters are refused too.
const DEFAULT_DENIED_ARGS = [/[;&|`$<>]/, /[\r\n]/];
const WINDOWS_DENIED_ARGS = [/[%^"!]/];
const DEFAULT_ENV = ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP", "LANG", "JAVA_HOME", "PATHEXT", "COMSPEC"];

/**
 * Runs external commands safely: no shell (so no injection through ";" or "|"), only allow-listed programs,
 * working folder locked to the workspace, secrets removed from the environment, timeout and output limits.
 */
export class CommandSandbox {
  private readonly root: string;

  constructor(private readonly policy: SandboxPolicy) {
    this.root = fs.realpathSync(path.resolve(policy.workspaceRoot));
  }

  check(command: string, args: string[], cwd?: string): string | undefined {
    const base = path.basename(command).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
    if (command.includes("/") || command.includes("\\")) return "Use a command name, not a path";
    if (!this.policy.allowedCommands.map((c) => c.toLowerCase()).includes(base)) return `Command not allowed: ${base}`;
    const denied = [...DEFAULT_DENIED_ARGS, ...(process.platform === "win32" ? WINDOWS_DENIED_ARGS : []), ...(this.policy.deniedArgs ?? [])];
    const bad = args.find((a) => denied.some((d) => d.test(a)));
    if (bad !== undefined) return `Argument not allowed: ${bad}`;
    const dir = path.resolve(this.root, cwd ?? ".");
    if (dir !== this.root && !dir.startsWith(this.root + path.sep)) return "Working folder is outside the workspace";
    return undefined;
  }

  run(command: string, args: string[] = [], cwd?: string): Promise<RunResult> {
    const problem = this.check(command, args, cwd);
    if (problem) return Promise.reject(new Error(problem));
    const started = Date.now();
    const timeout = this.policy.timeoutMs ?? 60_000;
    const max = this.policy.maxOutputChars ?? 200_000;
    const env: NodeJS.ProcessEnv = {};
    for (const k of this.policy.envAllowList ?? DEFAULT_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];

    return new Promise((resolve) => {
      const isWin = process.platform === "win32";
      // Windows: run through cmd.exe so npm.cmd / mvn.cmd work; arguments were checked for cmd metacharacters above.
      const [exe, argv] = isWin ? ["cmd.exe", ["/d", "/s", "/c", command, ...args]] : [command, args];
      const child = spawn(exe, argv, {
        cwd: path.resolve(this.root, cwd ?? "."),
        env,
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const cap = (buf: string, chunk: Buffer) => (buf.length < max ? buf + chunk.toString("utf8") : buf);
      child.stdout.on("data", (c: Buffer) => (stdout = cap(stdout, c)));
      child.stderr.on("data", (c: Buffer) => (stderr = cap(stderr, c)));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeout);
      const done = (exitCode: number | null, extra = "") => {
        clearTimeout(timer);
        resolve({
          command: [command, ...args].join(" "),
          exitCode,
          stdout: redactSecrets(stdout.slice(0, max), false),
          stderr: redactSecrets((stderr + extra).slice(0, max), false),
          timedOut,
          durationMs: Date.now() - started,
        });
      };
      child.on("error", (err) => done(null, String(err.message)));
      child.on("close", (code) => done(code));
    });
  }
}
