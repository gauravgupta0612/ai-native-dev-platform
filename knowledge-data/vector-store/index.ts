import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { postJson } from "../../common/typescript/src/models/providers/http";

/** Turns text into vectors. Swap the offline HashEmbedder for a real model in production. */
export interface Embedder {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Offline embedder (feature hashing of words + character trigrams). No network, deterministic,
 * good enough for code search and tests; use OpenAIEmbedder / OllamaEmbedder for semantic quality.
 */
export class HashEmbedder implements Embedder {
  constructor(readonly dimensions = 512) {}
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(this.dimensions).fill(0);
      const words = t.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
      const grams: string[] = [...words];
      for (const w of words) for (let i = 0; i + 3 <= w.length; i++) grams.push("#" + w.slice(i, i + 3));
      for (const g of grams) {
        const h = createHash("md5").update(g).digest();
        const idx = h.readUInt32LE(0) % this.dimensions;
        v[idx] += h[4] & 1 ? 1 : -1;
      }
      return normalize(v);
    });
  }
}

/** OpenAI-compatible /embeddings endpoint (OpenAI, Ollama /v1, Azure gateways). */
export class OpenAIEmbedder implements Embedder {
  constructor(private readonly baseUrl: string, private readonly model: string, readonly dimensions: number, private readonly apiKey?: string) {}
  async embed(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
    const data = await postJson("embeddings", `${this.baseUrl.replace(/\/+$/, "")}/embeddings`, { model: this.model, input: texts }, headers);
    return (data.data as Array<{ embedding: number[] }>).map((d) => normalize(d.embedding));
  }
}

export interface VectorRecord<M = Record<string, unknown>> {
  id: string;
  vector: number[];
  text: string;
  metadata: M;
}

export interface SearchHit<M = Record<string, unknown>> {
  id: string;
  score: number;
  text: string;
  metadata: M;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

/**
 * In-memory vector database with JSON persistence. Fine for tens of thousands of chunks;
 * implement the same methods over pgvector/Qdrant for larger data.
 */
export class VectorStore<M = Record<string, unknown>> {
  private readonly records = new Map<string, VectorRecord<M>>();

  constructor(private readonly embedder: Embedder = new HashEmbedder()) {}

  get size(): number { return this.records.size; }

  async upsert(items: Array<{ id: string; text: string; metadata: M }>): Promise<void> {
    const batch = 64;
    for (let i = 0; i < items.length; i += batch) {
      const slice = items.slice(i, i + batch);
      const vectors = await this.embedder.embed(slice.map((s) => s.text));
      slice.forEach((s, j) => this.records.set(s.id, { ...s, vector: vectors[j] }));
    }
  }

  delete(predicate: (r: VectorRecord<M>) => boolean): number {
    let n = 0;
    for (const [id, r] of this.records) if (predicate(r)) { this.records.delete(id); n++; }
    return n;
  }

  async search(query: string, topK = 5, filter?: (m: M) => boolean, minScore = 0): Promise<SearchHit<M>[]> {
    const [q] = await this.embedder.embed([query]);
    const hits: SearchHit<M>[] = [];
    for (const r of this.records.values()) {
      if (filter && !filter(r.metadata)) continue;
      const score = dot(q, r.vector);
      if (score >= minScore) hits.push({ id: r.id, score, text: r.text, metadata: r.metadata });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  save(file: string): void {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ dimensions: this.embedder.dimensions, records: [...this.records.values()] }));
  }

  load(file: string): void {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.dimensions !== this.embedder.dimensions) throw new Error("Embedding size mismatch: re-index with the same embedder");
    this.records.clear();
    for (const r of data.records as VectorRecord<M>[]) this.records.set(r.id, r);
  }
}
