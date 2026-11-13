import { ChatRequest, ChatResponse, ModelProvider } from "./types";
import { Logger } from "../observability/logger";
import { Metrics } from "../observability/metrics";

export interface RouteRule {
  /** Task label, e.g. "code-generation", "summarize", "chat". */
  task: string;
  provider: string;
  model?: string;
}

export interface RouteOptions {
  task?: string;
  /** Sensitive data: only the local provider may be used. */
  sensitive?: boolean;
}

/** Picks the provider/model for each request, with fallback on failure. */
export class ModelRouter {
  private readonly providers = new Map<string, ModelProvider>();
  private readonly rules: RouteRule[] = [];
  private defaultProvider?: string;
  private fallbackOrder: string[] = [];
  private localProvider?: string;

  constructor(
    private readonly logger: Logger = new Logger("router"),
    readonly metrics: Metrics = new Metrics(),
  ) {}

  register(provider: ModelProvider, opts: { isDefault?: boolean; isLocal?: boolean } = {}): this {
    this.providers.set(provider.name, provider);
    this.fallbackOrder.push(provider.name);
    if (opts.isDefault || !this.defaultProvider) this.defaultProvider = provider.name;
    if (opts.isLocal) this.localProvider = provider.name;
    return this;
  }

  addRule(rule: RouteRule): this {
    this.rules.push(rule);
    return this;
  }

  setDefault(name: string): this {
    if (!this.providers.has(name)) throw new Error(`Unknown provider: ${name}`);
    this.defaultProvider = name;
    return this;
  }

  setFallbackOrder(names: string[]): this {
    this.fallbackOrder = names.filter((n) => this.providers.has(n));
    return this;
  }

  listProviders(): string[] {
    return [...this.providers.keys()];
  }

  /** Returns the ordered list of [provider, model] candidates for a request. */
  plan(opts: RouteOptions = {}): Array<{ provider: string; model?: string }> {
    if (opts.sensitive) {
      if (!this.localProvider) throw new Error("Sensitive request but no local provider is registered");
      return [{ provider: this.localProvider }];
    }
    const out: Array<{ provider: string; model?: string }> = [];
    const rule = opts.task ? this.rules.find((r) => r.task === opts.task) : undefined;
    if (rule && this.providers.has(rule.provider)) out.push({ provider: rule.provider, model: rule.model });
    if (this.defaultProvider) out.push({ provider: this.defaultProvider });
    for (const n of this.fallbackOrder) out.push({ provider: n });
    const seen = new Set<string>();
    return out.filter((c) => (seen.has(c.provider) ? false : (seen.add(c.provider), true)));
  }

  async chat(req: ChatRequest, opts: RouteOptions = {}): Promise<ChatResponse> {
    const candidates = this.plan(opts);
    if (!candidates.length) throw new Error("No model provider registered");
    let lastError: unknown;
    for (const c of candidates) {
      const provider = this.providers.get(c.provider)!;
      const started = Date.now();
      try {
        const res = await provider.chat({ ...req, model: req.model ?? c.model });
        this.metrics.record(provider.name, res.usage, Date.now() - started, true);
        this.logger.debug("model call ok", { provider: provider.name, model: res.model, ms: Date.now() - started });
        return res;
      } catch (err) {
        lastError = err;
        this.metrics.record(provider.name, { inputTokens: 0, outputTokens: 0 }, Date.now() - started, false);
        this.logger.warn("model call failed, trying next provider", { provider: provider.name, error: String(err) });
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
