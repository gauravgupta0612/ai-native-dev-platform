import { createHash, timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import { Logger } from "../../common/typescript/src";
import type { AgentRole, AgentService } from "../../ai-orchestration/agent-runtime";

export interface ServerOptions {
  port: number;
  /** Bind address. Default 127.0.0.1 (local only); put a TLS reverse proxy in front for remote use. */
  host?: string;
  /** SHA-256 hashes (hex) of accepted API keys. Store hashes, never the keys. */
  apiKeyHashes: string[];
  /** Requests per minute per key. Default 30. */
  rateLimitPerMinute?: number;
  /** Max request body. Default 64 KB. */
  maxBodyBytes?: number;
  /** Allowed browser origins for CORS (none by default). */
  allowedOrigins?: string[];
}

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Token bucket per client. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();
  constructor(private readonly perMinute: number, private readonly now: () => number = Date.now) {}
  allow(client: string): boolean {
    const t = this.now();
    const b = this.buckets.get(client) ?? { tokens: this.perMinute, last: t };
    b.tokens = Math.min(this.perMinute, b.tokens + ((t - b.last) / 60_000) * this.perMinute);
    b.last = t;
    if (b.tokens < 1) { this.buckets.set(client, b); return false; }
    b.tokens -= 1;
    this.buckets.set(client, b);
    return true;
  }
}

/**
 * Server mode: lets other tools (CI, web UI, chat bots) use the platform's agents over HTTP.
 * Security: API key (constant-time compare against stored hashes), rate limit, body size limit,
 * strict JSON, role allow-list, no stack traces in responses, security headers, localhost by default.
 *   GET  /health
 *   POST /v1/agents/:role/ask   { "question": "..." }
 */
export function createPlatformServer(agents: AgentService, opts: ServerOptions, logger = new Logger("server")): http.Server {
  const limiter = new RateLimiter(opts.rateLimitPerMinute ?? 30);
  const maxBody = opts.maxBodyBytes ?? 64 * 1024;
  const hashes = opts.apiKeyHashes.map((h) => Buffer.from(h, "hex"));
  const roles: AgentRole[] = ["reader", "reviewer", "coder"];

  const authenticate = (req: http.IncomingMessage): string | undefined => {
    const header = req.headers.authorization ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!key) return undefined;
    const h = Buffer.from(hashApiKey(key), "hex");
    return hashes.some((x) => x.length === h.length && timingSafeEqual(x, h)) ? hashApiKey(key).slice(0, 12) : undefined;
  };

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
      "Referrer-Policy": "no-referrer",
    });
    res.end(JSON.stringify(body));
  };

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && opts.allowedOrigins?.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    try {
      if (req.method === "GET" && req.url === "/health") return send(res, 200, { status: "ok" });

      const client = authenticate(req);
      if (!client) return send(res, 401, { error: "unauthorized" });
      if (!limiter.allow(client)) return send(res, 429, { error: "rate limit exceeded" });

      const m = /^\/v1\/agents\/([a-z]+)\/ask$/.exec(req.url ?? "");
      if (req.method !== "POST" || !m) return send(res, 404, { error: "not found" });
      if (!roles.includes(m[1] as AgentRole)) return send(res, 400, { error: "unknown agent role" });
      if (!(req.headers["content-type"] ?? "").includes("application/json")) return send(res, 415, { error: "content-type must be application/json" });

      let size = 0;
      const chunks: Buffer[] = [];
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > maxBody) return send(res, 413, { error: "body too large" });
        chunks.push(c as Buffer);
      }
      let body: any;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { error: "invalid JSON" }); }
      if (typeof body?.question !== "string" || !body.question.trim()) return send(res, 400, { error: "question is required" });

      const result = await agents.ask(m[1] as AgentRole, body.question);
      logger.info("agent request", { client, role: m[1], stoppedReason: result.stoppedReason });
      return send(res, 200, { answer: result.output, stoppedReason: result.stoppedReason, steps: result.steps, usage: result.usage });
    } catch (e) {
      logger.error("request failed", { error: String(e) });
      return send(res, 500, { error: "internal error" });
    }
  });
}
