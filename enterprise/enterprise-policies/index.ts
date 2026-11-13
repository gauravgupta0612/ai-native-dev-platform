import * as fs from "node:fs";

/** policy.json — set by IT for the organization, optionally tightened per project. */
export interface PolicyFile {
  /** Providers allowed at all (others are removed from the router). */
  allowedProviders?: string[];
  /** Force local model only. */
  localOnly?: boolean;
  allowedTools?: string[];
  deniedTools?: string[];
  /** Regexes: requests matching these are refused. */
  blockedPatterns?: string[];
  /** Regexes for company-specific secrets (masked like API keys). */
  extraSecretPatterns?: string[];
  maskEmails?: boolean;
  maxInputChars?: number;
  maxAgentSteps?: number;
  maxTokensPerRun?: number;
  /** Allow agents to write files (with approval). */
  allowFileWrites?: boolean;
  /** Allow agents to run commands (with approval) and which ones. */
  allowedCommands?: string[];
  /** Only signed extensions from these publishers. */
  trustedPublishers?: string[];
  telemetry?: boolean;
}

export interface EffectivePolicy {
  allowedProviders?: string[];
  localOnly: boolean;
  allowedTools?: string[];
  deniedTools: string[];
  blockedPatterns: string[];
  extraSecretPatterns: string[];
  maskEmails: boolean;
  maxInputChars: number;
  maxAgentSteps: number;
  maxTokensPerRun?: number;
  allowFileWrites: boolean;
  allowedCommands: string[];
  trustedPublishers: string[];
  telemetry: boolean;
}

export const SECURE_DEFAULTS: EffectivePolicy = {
  localOnly: false,
  deniedTools: [],
  blockedPatterns: [],
  extraSecretPatterns: [],
  maskEmails: true,
  maxInputChars: 100_000,
  maxAgentSteps: 16,
  maxTokensPerRun: 200_000,
  allowFileWrites: false,
  allowedCommands: ["git", "npm", "mvn", "gradle", "python", "pytest", "node", "dotnet"],
  trustedPublishers: [],
  telemetry: false,
};

const intersect = (a?: string[], b?: string[]) => (a && b ? a.filter((x) => b.includes(x)) : a ?? b);
const minDefined = (...v: Array<number | undefined>) => {
  const d = v.filter((x): x is number => typeof x === "number");
  return d.length ? Math.min(...d) : undefined;
};

/**
 * Merges policies so that later layers can only make things STRICTER:
 * allow-lists intersect, deny-lists and patterns add up, limits take the minimum, booleans that grant power AND together.
 */
export function mergePolicies(...layers: PolicyFile[]): EffectivePolicy {
  let p: EffectivePolicy = { ...SECURE_DEFAULTS };
  layers.forEach((l, i) => {
    // The first layer (organization) may turn powers on; later layers (project) can only turn them off.
    const power = (current: boolean, value: boolean | undefined) => (value === undefined ? current : i === 0 ? value : current && value);
    p = {
      allowedProviders: intersect(p.allowedProviders, l.allowedProviders),
      localOnly: p.localOnly || !!l.localOnly,
      allowedTools: intersect(p.allowedTools, l.allowedTools),
      deniedTools: [...new Set([...p.deniedTools, ...(l.deniedTools ?? [])])],
      blockedPatterns: [...p.blockedPatterns, ...(l.blockedPatterns ?? [])],
      extraSecretPatterns: [...p.extraSecretPatterns, ...(l.extraSecretPatterns ?? [])],
      maskEmails: p.maskEmails || !!l.maskEmails,
      maxInputChars: minDefined(p.maxInputChars, l.maxInputChars)!,
      maxAgentSteps: minDefined(p.maxAgentSteps, l.maxAgentSteps)!,
      maxTokensPerRun: minDefined(p.maxTokensPerRun, l.maxTokensPerRun),
      allowFileWrites: power(p.allowFileWrites, l.allowFileWrites),
      allowedCommands: l.allowedCommands ? p.allowedCommands.filter((c) => l.allowedCommands!.includes(c)) : p.allowedCommands,
      trustedPublishers: l.trustedPublishers ? (p.trustedPublishers.length ? p.trustedPublishers.filter((t) => l.trustedPublishers!.includes(t)) : l.trustedPublishers) : p.trustedPublishers,
      telemetry: power(p.telemetry, l.telemetry),
    };
  });
  return p;
}

/** Validates a policy file and returns problems (bad regexes, wrong types). */
export function validatePolicy(p: PolicyFile): string[] {
  const errors: string[] = [];
  for (const key of ["blockedPatterns", "extraSecretPatterns"] as const) {
    for (const r of p[key] ?? []) {
      try { new RegExp(r); } catch { errors.push(`${key}: invalid regex ${r}`); }
    }
  }
  for (const key of ["maxInputChars", "maxAgentSteps", "maxTokensPerRun"] as const) {
    if (p[key] !== undefined && (!Number.isInteger(p[key]) || (p[key] as number) <= 0)) errors.push(`${key} must be a positive integer`);
  }
  return errors;
}

/** Loads organization policy then project policy (missing files are skipped). Throws on invalid content. */
export function loadPolicies(...files: string[]): EffectivePolicy {
  const layers: PolicyFile[] = [];
  for (const f of files) {
    if (!f || !fs.existsSync(f)) continue;
    const p = JSON.parse(fs.readFileSync(f, "utf8")) as PolicyFile;
    const problems = validatePolicy(p);
    if (problems.length) throw new Error(`${f}: ${problems.join("; ")}`);
    layers.push(p);
  }
  return mergePolicies(...layers);
}
