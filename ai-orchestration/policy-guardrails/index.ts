import { PolicyGuardrails } from "../../common/typescript/src";
import { EffectivePolicy } from "../../enterprise/enterprise-policies";
import { toolsForRole } from "../tool-execution";

/**
 * Turns the effective enterprise/project policy + the agent's role into PolicyGuardrails.
 * Allowed tools = role preset ∩ policy allow-list, minus policy deny-list.
 */
export function guardrailsFor(policy: EffectivePolicy, role: string): PolicyGuardrails {
  const roleTools = toolsForRole(role);
  let allowed: string[] | undefined = roleTools;
  if (policy.allowedTools) allowed = allowed ? allowed.filter((t) => policy.allowedTools!.includes(t)) : policy.allowedTools;
  return new PolicyGuardrails({
    allowedTools: allowed,
    deniedTools: policy.deniedTools,
    blockedPatterns: policy.blockedPatterns.map((p) => new RegExp(p, "i")),
    extraSecretPatterns: policy.extraSecretPatterns.map((p) => new RegExp(p, "g")),
    maskEmails: policy.maskEmails,
    maxInputChars: policy.maxInputChars,
  });
}
