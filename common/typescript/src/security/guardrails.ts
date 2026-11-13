export interface GuardrailOptions {
  /** Extra regexes whose matches are masked before text leaves the machine. */
  extraSecretPatterns?: RegExp[];
  /** Input containing any of these is refused. */
  blockedPatterns?: RegExp[];
  /** If set, only these tools may run. */
  allowedTools?: string[];
  /** These tools may never run. */
  deniedTools?: string[];
  /** Mask e-mail addresses too (default true). */
  maskEmails?: boolean;
}

export interface CheckResult {
  allowed: boolean;
  reasons: string[];
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI / Anthropic style keys
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google API keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\b(?:xox[abpr])-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"']{4,}/gi,
];
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Policy & guardrails: masks secrets/PII, blocks forbidden input, controls which tools run. */
export class PolicyGuardrails {
  constructor(private readonly opts: GuardrailOptions = {}) {}

  /** Replaces secrets (and e-mails) with "xxxx". */
  redact(text: string): string {
    let out = text;
    for (const p of [...SECRET_PATTERNS, ...(this.opts.extraSecretPatterns ?? [])]) {
      out = out.replace(new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g"), (m, key) =>
        typeof key === "string" && /^[a-z_-]+$/i.test(key) ? `${key}=xxxx` : "xxxx",
      );
    }
    if (this.opts.maskEmails ?? true) out = out.replace(EMAIL, "xxxx");
    return out;
  }

  checkInput(text: string): CheckResult {
    const reasons = (this.opts.blockedPatterns ?? [])
      .filter((p) => new RegExp(p.source, p.flags.replace("g", "")).test(text))
      .map((p) => `Blocked pattern: ${p.source}`);
    return { allowed: reasons.length === 0, reasons };
  }

  checkTool(name: string): CheckResult {
    if (this.opts.deniedTools?.includes(name)) return { allowed: false, reasons: [`Tool denied by policy: ${name}`] };
    if (this.opts.allowedTools && !this.opts.allowedTools.includes(name)) {
      return { allowed: false, reasons: [`Tool not in allow-list: ${name}`] };
    }
    return { allowed: true, reasons: [] };
  }
}
