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
  maxSteps?: number;
  name?: string;
}

export interface AgentResult {
  output: string;
  steps: number;
  toolCalls: number;
  usage: Usage;
  stoppedReason: "completed" | "max-steps" | "blocked";
}

/**
 * Agent loop: ask model -> run requested tools -> feed results back -> repeat until the model answers.
 * Guardrails mask secrets before sending, and every tool call is policy-checked and audited.
 */
export class AgentRuntime {
  readonly name: string;
  private readonly tools: ToolRegistry;
  private readonly guardrails: PolicyGuardrails;
  private readonly audit: AuditLog;
  private readonly logger: Logger;
  private readonly maxSteps: number;

  constructor(private readonly opts: AgentOptions) {
    this.name = opts.name ?? "agent";
    this.tools = opts.tools ?? new ToolRegistry();
    this.guardrails = opts.guardrails ?? new PolicyGuardrails();
    this.audit = opts.audit ?? new AuditLog();
    this.logger = opts.logger ?? new Logger(this.name);
    this.maxSteps = opts.maxSteps ?? 8;
  }

  async run(task: string, context = new ContextManager(), route: RouteOptions = {}): Promise<AgentResult> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const check = this.guardrails.checkInput(task);
    if (!check.allowed) {
      this.audit.record(this.name, "input.blocked", { reasons: check.reasons });
      return { output: `Request blocked: ${check.reasons.join("; ")}`, steps: 0, toolCalls: 0, usage, stoppedReason: "blocked" };
    }
    context.addUser(this.guardrails.redact(task));
    this.audit.record(this.name, "run.start", { task: this.guardrails.redact(task).slice(0, 200) });

    let toolCalls = 0;
    for (let step = 1; step <= this.maxSteps; step++) {
      const res = await this.opts.router.chat({ messages: context.build(), tools: this.tools.specs() }, route);
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      context.addAssistant(res.content, res.toolCalls.length ? res.toolCalls : undefined);

      if (!res.toolCalls.length) {
        this.audit.record(this.name, "run.complete", { steps: step, provider: res.provider, model: res.model });
        return { output: res.content, steps: step, toolCalls, usage, stoppedReason: "completed" };
      }

      for (const call of res.toolCalls) {
        toolCalls++;
        const policy = this.guardrails.checkTool(call.name);
        const result = policy.allowed
          ? await this.tools.execute(call, this.opts.approver)
          : { callId: call.id, name: call.name, ok: false, output: policy.reasons.join("; ") };
        this.audit.record(this.name, "tool.call", { tool: call.name, ok: result.ok });
        this.logger.debug("tool executed", { tool: call.name, ok: result.ok });
        context.addToolResult(call.id, call.name, this.guardrails.redact(result.output));
      }
    }
    this.audit.record(this.name, "run.max-steps", { maxSteps: this.maxSteps });
    return { output: "Stopped: maximum number of steps reached.", steps: this.maxSteps, toolCalls, usage, stoppedReason: "max-steps" };
  }
}
