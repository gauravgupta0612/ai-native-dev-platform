import { AgentResult } from "../../common/typescript/src";
import type { AgentRole, AgentService } from "../../ai-orchestration/agent-runtime";

export interface WorkflowStep {
  id: string;
  role: AgentRole;
  /** Prompt template; {{input}} and {{steps.<id>}} are replaced with earlier outputs. */
  prompt: string;
  /** Run only when this returns true (e.g. reviewer found problems). */
  when?: (outputs: Record<string, string>) => boolean;
}

export interface Workflow {
  name: string;
  steps: WorkflowStep[];
  /** Stop the workflow if a step does not complete. Default true. */
  stopOnIncomplete?: boolean;
}

export interface WorkflowRun {
  workflow: string;
  outputs: Record<string, string>;
  results: Record<string, AgentResult>;
  skipped: string[];
  completed: boolean;
}

const MAX_INJECTED = 20_000;

export function renderPrompt(template: string, input: string, outputs: Record<string, string>): string {
  return template
    .replace(/\{\{input\}\}/g, input)
    .replace(/\{\{steps\.([\w-]+)\}\}/g, (_m, id) => (outputs[id] ?? "").slice(0, MAX_INJECTED));
}

/** Runs agents one after another, passing outputs forward (planner → coder → reviewer → fixer). */
export class WorkflowEngine {
  constructor(private readonly agents: AgentService) {}

  async run(wf: Workflow, input: string, onStep?: (id: string, r: AgentResult) => void): Promise<WorkflowRun> {
    const run: WorkflowRun = { workflow: wf.name, outputs: {}, results: {}, skipped: [], completed: true };
    for (const step of wf.steps) {
      if (step.when && !step.when(run.outputs)) { run.skipped.push(step.id); continue; }
      const prompt = renderPrompt(step.prompt, input, run.outputs);
      const r = await this.agents.ask(step.role, prompt);
      run.results[step.id] = r;
      run.outputs[step.id] = r.output;
      onStep?.(step.id, r);
      if (r.stoppedReason !== "completed" && wf.stopOnIncomplete !== false) { run.completed = false; break; }
    }
    return run;
  }
}

/** Ready-made workflows. */
export const WORKFLOWS: Record<string, Workflow> = {
  "plan-implement-review": {
    name: "plan-implement-review",
    steps: [
      { id: "plan", role: "reader", prompt: "Create a short step-by-step implementation plan (files to change, risks) for:\n{{input}}" },
      { id: "implement", role: "coder", prompt: "Implement this plan:\n{{steps.plan}}\n\nOriginal request:\n{{input}}" },
      { id: "review", role: "reviewer", prompt: "Review the implementation below. Start your answer with APPROVED or CHANGES NEEDED.\n{{steps.implement}}" },
      { id: "fix", role: "coder", prompt: "Apply the review feedback:\n{{steps.review}}", when: (o) => /CHANGES NEEDED/i.test(o.review ?? "") },
    ],
  },
  "bug-triage": {
    name: "bug-triage",
    steps: [
      { id: "locate", role: "reader", prompt: "Find the code most likely responsible for this bug, cite file:line:\n{{input}}" },
      { id: "root-cause", role: "reviewer", prompt: "Explain the root cause and propose a fix:\nBug: {{input}}\nFindings: {{steps.locate}}" },
    ],
  },
};
