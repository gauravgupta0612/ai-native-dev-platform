import type { PolicyFile } from "../enterprise-policies";
import type { RoutingConfig } from "../../ai-orchestration/model-router";

export type DeploymentProfile = "cloud" | "hybrid" | "on-prem" | "air-gapped";

export interface DeploymentSettings {
  profile: DeploymentProfile;
  routing: Partial<RoutingConfig>;
  policy: PolicyFile;
  autoUpdate: boolean;
  description: string;
}

/** Ready-made settings per deployment type. Apply with mergePolicies() and buildRouter(). */
export const PROFILES: Record<DeploymentProfile, DeploymentSettings> = {
  cloud: {
    profile: "cloud",
    description: "Cloud models with local fallback. Fastest setup.",
    routing: { providers: ["anthropic", "openai", "gemini", "ollama", "echo"] },
    policy: {},
    autoUpdate: true,
  },
  hybrid: {
    profile: "hybrid",
    description: "Cloud for general work; sensitive data automatically stays on the local model.",
    routing: { providers: ["anthropic", "openai", "ollama"] },
    policy: { maskEmails: true },
    autoUpdate: true,
  },
  "on-prem": {
    profile: "on-prem",
    description: "Only your company gateway (custom provider) and local models.",
    routing: { providers: ["custom", "ollama"] },
    policy: { allowedProviders: ["custom", "ollama"], telemetry: false },
    autoUpdate: false,
  },
  "air-gapped": {
    profile: "air-gapped",
    description: "No network: local models only, no integrations, no auto-update.",
    routing: { providers: ["ollama"], localOnly: true },
    policy: { localOnly: true, allowedProviders: ["ollama"], deniedTools: ["jira_get_issue", "jira_search", "github_list_prs", "github_list_issues"], telemetry: false },
    autoUpdate: false,
  },
};

export function profileFromEnv(env: Record<string, string | undefined> = process.env): DeploymentSettings {
  const p = (env.DEPLOYMENT_PROFILE ?? "cloud") as DeploymentProfile;
  if (!PROFILES[p]) throw new Error(`Unknown DEPLOYMENT_PROFILE: ${p}`);
  return PROFILES[p];
}
