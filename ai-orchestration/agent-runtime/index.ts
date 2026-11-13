import { AgentResult, AgentRuntime, AuditLog, Logger, ModelRouter, RouteOptions, ToolRegistry } from "../../common/typescript/src";
import { EffectivePolicy } from "../../enterprise/enterprise-policies";
import { PermissionManager } from "../../security/permission-control";
import { DataPrivacy } from "../../security/data-privacy";
import { PlatformContextBuilder } from "../context-manager";
import { guardrailsFor } from "../policy-guardrails";
import { Telemetry } from "../observability";

export type AgentRole = "reader" | "reviewer" | "coder";

export interface AgentPreset {
  role: AgentRole;
  task: string;
  systemPrompt: string;
  maxSteps: number;
}

export const PRESETS: Record<AgentRole, AgentPreset> = {
  reader: { role: "reader", task: "quick-answer", maxSteps: 6, systemPrompt: "Answer questions about the code base. Read code before answering; cite file:line." },
  reviewer: { role: "reviewer", task: "code-review", maxSteps: 10, systemPrompt: "Review changes for bugs, security issues and readability. Be specific and cite file:line." },
  coder: { role: "coder", task: "code-generation", maxSteps: 16, systemPrompt: "Implement the requested change. Read relevant code first, keep changes minimal, explain what you changed." },
};

export interface AgentServices {
  router: ModelRouter;
  tools: ToolRegistry;
  policy: EffectivePolicy;
  permissions: PermissionManager;
  audit: AuditLog;
  context: PlatformContextBuilder;
  telemetry?: Telemetry;
  privacy?: DataPrivacy;
  logger?: Logger;
}

/**
 * Creates and runs role-based agents with all platform protections wired in:
 * policy guardrails, permission prompts for risky tools, data classification (sensitive -> local model),
 * token budgets from policy, audit and telemetry.
 */
export class AgentService {
  constructor(private readonly s: AgentServices) {}

  async ask(role: AgentRole, question: string, project?: Parameters<PlatformContextBuilder["build"]>[1]): Promise<AgentResult & { routedLocal: boolean }> {
    const preset = PRESETS[role];
    const privacy = this.s.privacy ?? new DataPrivacy();
    const cls = privacy.classify(question);
    const localOnly = this.s.policy.localOnly || !!project?.localOnly;
    const route: RouteOptions = { task: preset.task, sensitive: localOnly || (cls.keepLocal && this.s.router.listProviders().includes("ollama")) };

    const agent = new AgentRuntime({
      name: `${role}-agent`,
      router: this.s.router,
      tools: this.s.tools,
      guardrails: guardrailsFor(this.s.policy, role),
      audit: this.s.audit,
      logger: this.s.logger,
      approver: this.s.permissions.toolApprover(`${role}-agent`),
      maxSteps: Math.min(preset.maxSteps, this.s.policy.maxAgentSteps),
      maxTotalTokens: this.s.policy.maxTokensPerRun,
    });
    const ctx = await this.s.context.build(question, project, { systemPrompt: preset.systemPrompt });
    const started = Date.now();
    const result = await agent.run(question, ctx, route);
    const provider = this.s.router.listProviders().find((p) => this.s.router.metrics.snapshot()[p]?.calls) ?? undefined;
    this.s.telemetry?.recordRun(`${role}-agent`, result, Date.now() - started, provider, preset.task);
    return { ...result, routedLocal: !!route.sensitive };
  }
}
