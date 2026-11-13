import * as fs from "node:fs";
import * as path from "node:path";
import { ModelRouter, PolicyGuardrails } from "../../common/typescript/src";
import { CommandSandbox, RunResult } from "../../security/sandbox";

export interface TestCommand {
  command: string;
  args: string[];
  framework: string;
}

/** Finds how to run the tests of a project. */
export function detectTestCommand(root: string): TestCommand | undefined {
  const has = (f: string) => fs.existsSync(path.join(root, f));
  if (has("package.json")) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg.scripts?.test) return { command: "npm", args: ["test", "--silent"], framework: "npm test" };
  }
  if (has("pom.xml")) return { command: "mvn", args: ["-q", "-B", "test"], framework: "maven" };
  if (has("build.gradle") || has("build.gradle.kts")) return { command: "gradle", args: ["test", "-q"], framework: "gradle" };
  if (has("pyproject.toml") || has("pytest.ini") || has("tests")) return { command: "python", args: ["-m", "pytest", "-q"], framework: "pytest" };
  return undefined;
}

export interface TestFailure {
  test: string;
  message: string;
  location?: string;
}

/** Pulls failing test names and messages out of common runner output (node:test, Jest, JUnit/Maven, pytest). */
export function parseFailures(output: string): TestFailure[] {
  const out: TestFailure[] = [];
  const lines = output.split(/\r?\n/);
  lines.forEach((l, i) => {
    let m: RegExpExecArray | null;
    if ((m = /^not ok \d+ - (.+)$/.exec(l))) out.push({ test: m[1], message: lines.slice(i + 1, i + 6).join(" ").trim().slice(0, 300) });
    else if ((m = /^\s*●\s+(.+)$/.exec(l))) out.push({ test: m[1], message: (lines[i + 2] ?? "").trim() });
    else if ((m = /^\[ERROR\]\s+(\S+)\s+.*?(?:FAILURE|ERROR)!?\s*$/.exec(l)) || (m = /^\[ERROR\]\s+([\w.]+:\d+)\s+(.+)$/.exec(l))) out.push({ test: m[1], message: (m[2] ?? lines[i + 1] ?? "").trim() });
    else if ((m = /^FAILED\s+(\S+?)(?:\s+-\s+(.+))?$/.exec(l))) out.push({ test: m[1], message: (m[2] ?? "").trim() });
  });
  return out.slice(0, 50);
}

export interface TestReport {
  framework: string;
  passed: boolean;
  result: RunResult;
  failures: TestFailure[];
  analysis?: string;
}

/** Runs the project's tests in the sandbox and (optionally) asks the AI to explain failures and propose fixes. */
export class TestAssistant {
  constructor(private readonly sandbox: CommandSandbox, private readonly root: string, private readonly router?: ModelRouter, private readonly guardrails = new PolicyGuardrails()) {}

  async run(analyze = true): Promise<TestReport> {
    const cmd = detectTestCommand(this.root);
    if (!cmd) throw new Error("No test setup found (package.json test script, pom.xml, build.gradle or pytest)");
    const result = await this.sandbox.run(cmd.command, cmd.args);
    const passed = result.exitCode === 0 && !result.timedOut;
    const failures = passed ? [] : parseFailures(result.stdout + "\n" + result.stderr);
    const report: TestReport = { framework: cmd.framework, passed, result, failures };
    if (!passed && analyze && this.router) report.analysis = await this.analyze(report);
    return report;
  }

  async analyze(report: TestReport): Promise<string> {
    const output = this.guardrails.redact((report.result.stdout + "\n" + report.result.stderr).slice(-12_000));
    const res = await this.router!.chat(
      {
        messages: [
          { role: "system", content: "You are a senior engineer debugging failing tests. For each failure: likely root cause, the file/line to look at, and a concrete fix. Be brief." },
          { role: "user", content: `Framework: ${report.framework}\nFailures: ${JSON.stringify(report.failures)}\n\nOutput (tail):\n${output}` },
        ],
        temperature: 0.1,
      },
      { task: "code-review" },
    );
    return res.content;
  }

  /** Explains a stack trace or error message. */
  async explainError(errorText: string, language?: string): Promise<string> {
    const res = await this.router!.chat({
      messages: [
        { role: "system", content: "Explain the error, the most likely cause, and how to fix it. Show a minimal code fix if useful." },
        { role: "user", content: `${language ? `Language: ${language}\n` : ""}${this.guardrails.redact(errorText).slice(0, 12_000)}` },
      ],
    }, { task: "code-review" });
    return res.content;
  }
}
