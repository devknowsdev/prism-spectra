import type { ExecutorName, Patch, TaskPacket } from "../types.js";
import { classifyTaskHeuristic, type TaskClass } from "../routing/l1Classifier.js";
import type { EmbeddingProvider } from "../embeddings/ollamaEmbeddings.js";
import type { CacheLookup } from "./patternCache.js";

export interface SemanticCacheEntry {
  key: string;
  nodeType: string;
  taskClass: TaskClass;
  intent: string;
  output: string;
  originProvider: ExecutorName;
  originTokensIn: number;
  originTokensOut: number;
  originPatch?: Patch;
  embedding: number[];
  createdAtMs: number;
}

export interface SemanticCacheOptions {
  provider: EmbeddingProvider;
  similarityThreshold?: number;
  now?: () => number;
}

export interface SemanticCacheLookup extends CacheLookup {
  semantic?: true;
  similarity?: number;
  reason?: string;
}

const DEFAULT_TTL_SECONDS: Record<TaskClass, number> = {
  code: 15 * 60,
  reasoning: 2 * 60 * 60,
  creative: 2 * 60 * 60,
  general: 60 * 60,
  unknown: 60 * 60,
};

export class SemanticPatternCache {
  private entries: SemanticCacheEntry[] = [];
  private provider: EmbeddingProvider;
  private threshold: number;
  private now: () => number;
  private degradedReason: string | null = null;

  constructor(opts: SemanticCacheOptions) {
    this.provider = opts.provider;
    this.threshold = resolveSimilarityThreshold(opts.similarityThreshold);
    this.now = opts.now ?? Date.now;
  }

  get lastDegradedReason(): string | null {
    return this.degradedReason;
  }

  canUse(packet: TaskPacket): boolean {
    if (packet.node_type === "terminal") return false;
    if (packet.filePaths && packet.filePaths.length > 0) return false;
    if (hasTargetFileContext(packet.context)) return false;
    return true;
  }

  async get(packet: TaskPacket): Promise<SemanticCacheLookup> {
    if (!this.canUse(packet)) return { hit: false, reason: "semantic cache disabled for mutating or terminal packet" };
    const taskClass = classifyTaskHeuristic(packet).taskClass;
    const query = semanticSignature(packet);
    const queryEmbedding = await this.embedSafe(query);
    if (!queryEmbedding) return { hit: false, reason: this.degradedReason ?? "embedding unavailable" };

    let best: { entry: SemanticCacheEntry; similarity: number } | null = null;
    const now = this.now();
    for (const entry of this.entries) {
      if (entry.nodeType !== packet.node_type) continue;
      if (entry.taskClass !== taskClass) continue;
      if (now - entry.createdAtMs > ttlMsFor(taskClass)) continue;
      const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
      if (!best || similarity > best.similarity) {
        best = { entry, similarity };
      }
    }

    if (!best || best.similarity < this.threshold) {
      return { hit: false };
    }

    return {
      hit: true,
      semantic: true,
      similarity: best.similarity,
      output: best.entry.output,
      originProvider: best.entry.originProvider,
      originTokensIn: best.entry.originTokensIn,
      originTokensOut: best.entry.originTokensOut,
      originPatch: best.entry.originPatch,
    };
  }

  async set(
    packet: TaskPacket,
    output: string,
    originProvider: ExecutorName,
    originTokensIn: number,
    originTokensOut: number,
    originPatch?: Patch,
  ): Promise<void> {
    if (!this.canUse(packet)) return;
    if (originPatch) return;
    const query = semanticSignature(packet);
    const embedding = await this.embedSafe(query);
    if (!embedding) return;
    const taskClass = classifyTaskHeuristic(packet).taskClass;
    const key = `${packet.node_type}:${taskClass}:${query}`;

    const entry: SemanticCacheEntry = {
      key,
      nodeType: packet.node_type,
      taskClass,
      intent: packet.intent,
      output,
      originProvider,
      originTokensIn,
      originTokensOut,
      originPatch,
      embedding,
      createdAtMs: this.now(),
    };

    const existing = this.entries.findIndex((candidate) => candidate.key === key);
    if (existing >= 0) {
      this.entries[existing] = entry;
    } else {
      this.entries.push(entry);
    }
    this.prune();
  }

  private async embedSafe(input: string): Promise<number[] | null> {
    try {
      const embedding = await this.provider.embed(input);
      if (!embedding) {
        this.degradedReason = "embedding provider returned no vector";
        return null;
      }
      this.degradedReason = null;
      return embedding;
    } catch (error) {
      this.degradedReason = (error as Error).message;
      return null;
    }
  }

  private prune(): void {
    const now = this.now();
    this.entries = this.entries.filter((entry) => now - entry.createdAtMs <= ttlMsFor(entry.taskClass));
  }
}

export function semanticSignature(packet: TaskPacket): string {
  return JSON.stringify({
    node_type: packet.node_type,
    intent: normalizeText(packet.intent),
    context: semanticContext(packet.context),
  });
}

function semanticContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (key === "routing" || key === "conversationId") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null) {
      out[key] = value;
    }
  }
  return out;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function resolveSimilarityThreshold(option?: number): number {
  const raw = option ?? Number(process.env.SPECTRA_SEMANTIC_CACHE_THRESHOLD ?? "0.92");
  return Number.isFinite(raw) ? clamp(raw, 0, 1) : 0.92;
}

function ttlMsFor(taskClass: TaskClass): number {
  const envKey = `SPECTRA_CACHE_TTL_${taskClass.toUpperCase()}`;
  const seconds = Number(process.env[envKey] ?? DEFAULT_TTL_SECONDS[taskClass]);
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TTL_SECONDS[taskClass];
  return safeSeconds * 1000;
}

function hasTargetFileContext(context: Record<string, unknown>): boolean {
  return Boolean(context.targetFile || context.targetFiles || context.patch || context.writeFile);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
