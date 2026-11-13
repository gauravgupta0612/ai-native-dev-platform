import { Usage } from "../models/types";
import { ModelRouter, RouteOptions } from "../models/router";
import { Logger } from "../observability/logger";
import { AuditLog } from "../security/audit-log";
import { PolicyGuardrails } from "../security/guardrails";
import { ContextManager } from "./context-manager";
import { Approver, ToolRegistry } from "./tool-registry";

export interface AgentOptions {
  router: ModelRouter;
  tools?: ToolRegistry;
  guardrails?: PolicyGuardrails;
  audit?: AuditLog;
  logger?: Logger;
  approver?: Approver;
  /** Max model calls per run. Default 8. */
  maxSteps?: number;
  /** Stop when input+output tokens of this run exceed this budget. Default: no limit. */
  maxTotalTokens?: number;
  /** Max tool calls per run (protects against loops). Default 25. */
  maxToolCalls?: number;
  name?: string;
}

export interface AgentResult {
  output: string;
  steps: number;
  toolCalls: number;
  usage: Usage;
  stoppedReason: "completed" | "max-steps" | "blocked" | "budget" | "max-tool-calls";
}

/**
 * Agent loop: ask model -> run requested tools -> feed results back -> repeat until the model answers.
 * Security: input checks, secret masking before every send, tool policy + approval, prompt-injection
 * flagging of tool output, step/tool/token budgets and a hash-chained audit trail.
 */
export class AgentRuntime {
  readonly name: string;
  private readonly tools: ToolRegistry;
  private readonly guardrails: PolicyGuardrails;
  private readonly audit: AuditLog;
  private readonly logger: Logger;

  constructor(private readonly opts: AgentOptions) {
    this.name = opts.name ?? "agent";
    this.tools = opts.tools ?? new ToolRegistry();
    this.guardrails = opts.guardrails ?? new PolicyGuardrails();
    this.audit = opts.audit ?? new AuditLog();
    this.logger = opts.logger ?? new Logger(this.name);
  }

  async run(task: string, context = new ContextManager(), route: RouteOptions = {}): Promise<AgentResult> {
    const maxSteps = this.opts.maxSteps ?? 8;
    const maxToolCalls = this.opts.maxToolCalls ?? 25;
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const finish = (output: string, steps: number, toolCalls: number, stoppedReason: AgentResult["stoppedReason"]): AgentResult => {
      this.audit.record(this.name, `run.${stoppedReason}`, { steps, toolCalls, ...usage });
      return { output, steps, toolCalls, usage, stoppedReason };
    };

    const check = this.guardrails.checkInput(task);
    if (!check.allowed) {
      this.audit.record(this.name, "input.blocked", { reasons: check.reasons });
      return { output: `Request blocked: ${check.reasons.join("; ")}`, steps: 0, toolCalls: 0, usage, stoppedReason: "blocked" };
    }
    const safeTask = this.guardrails.redact(task);
    context.addUser(safeTask);
    this.audit.record(this.name, "run.start", { task: safeTask.slice(0, 200), sensitive: !!route.sensitive });

    let toolCalls = 0;
    for (let step = 1; step <= maxSteps; step++) {
      const messages = context.build().map((m) => ({ ...m, content: this.guardrails.redact(m.content) }));
      const res = await this.opts.router.chat({ messages, tools: this.tools.specs() }, route);
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      context.addAssistant(res.content, res.toolCalls.length ? res.toolCalls : undefined);

      if (!res.toolCalls.length) return finish(res.content, step, toolCalls, "completed");

      for (const call of res.toolCalls) {
        if (toolCalls >= maxToolCalls) {
          context.addToolResult(call.id, call.name, "Skipped: tool call limit reached");
          continue;
        }
        toolCalls++;
        const policy = this.guardrails.checkTool(call.name);
        const result = policy.allowed
          ? await this.tools.execute(call, this.opts.approver)
          : { callId: call.id, name: call.name, ok: false, output: policy.reasons.join("; ") };
        const wrapped = this.guardrails.wrapUntrusted(`tool ${call.name}`, this.guardrails.redact(result.output));
        this.audit.record(this.name, "tool.call", { tool: call.name, ok: result.ok, injectionSuspected: wrapped.suspicious.length > 0 });
        if (wrapped.suspicious.length) this.logger.warn("possible prompt injection in tool output", { tool: call.name });
        this.logger.debug("tool executed", { tool: call.name, ok: result.ok });
        context.addToolResult(call.id, call.name, wrapped.text);
      }

      const budget = this.opts.maxTotalTokens;
      if (budget !== undefined && usage.inputTokens + usage.outputTokens >= budget) {
        return finish("Stopped: token budget reached.", step, toolCalls, "budget");
      }
      if (toolCalls >= maxToolCalls) return finish("Stopped: tool call limit reached.", step, toolCalls, "max-tool-calls");
    }
    return finish("Stopped: maximum number of steps reached.", maxSteps, toolCalls, "max-steps");
  }
}
