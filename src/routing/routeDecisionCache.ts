import type { ExecutorName, NodeType, TaskPacket } from "../types.js";
import type { EmbeddingProvider } from "../embeddings/ollamaEmbeddings.js";
import { classifyTaskHeuristic, type TaskClass } from "./l1Classifier.js";
import type { ModelRole } from "../executors/ollama.js";

export interface RouteDecisionCacheEntry {
  key: string;
  nodeType: NodeType;
  taskClass: TaskClass;
  role: ModelRole;
  paidProviderPreference?: "gpt" | "claude";
  embedding: number[];
  createdAtMs: number;
}

export interface RouteDecisionHint {
  hit: boolean;
  role?: ModelRole;
  taskClass?: TaskClass;
  paidProviderPreference?: "gpt" | "claude";
  similarity?: number;
  reason?: string;
}

export interface RouteDecisionCacheOptions {
  provider: EmbeddingProvider;
  similarityThreshold?: number;
  now?: () => number;
}

const DEFAULT_TTL_SECONDS: Record<TaskClass, number> = {
  code: 1800,
  reasoning: 7200,
  creative: 7200,
  general: 3600,
  unknown: 1800,
};

export class RouteDecisionCache {
  private entries: RouteDecisionCacheEntry[] = [];
  private provider: EmbeddingProvider;
  private threshold: number;
  private now: () => number;
  private degradedReason: string | null = null;

  constructor(opts: RouteDecisionCacheOptions) {
    this.provider = opts.provider;
    this.threshold = resolveThreshold(opts.similarityThreshold);
    this.now = opts.now ?? Date.now;
  }

  get lastDegradedReason(): string | null {
    return this.degradedReason;
  }

  canUse(packet: TaskPacket): boolean {
    return packet.node_type !== "terminal";
  }

  async get(packet: TaskPacket): Promise<RouteDecisionHint> {
    if (!this.canUse(packet)) return { hit: false, reason: "route cache disabled for terminal packet" };
    const l1 = classifyTaskHeuristic(packet);
    const embedding = await this.embedSafe(routeSignature(packet));
    if (!embedding) return { hit: false, reason: this.degradedReason ?? "embedding unavailable" };

    let best: { entry: RouteDecisionCacheEntry; similarity: number } | null = null;
    const now = this.now();
    for (const entry of this.entries) {
      if (entry.nodeType !== packet.node_type) continue;
      if (entry.taskClass !== l1.taskClass) continue;
      if (now - entry.createdAtMs > ttlMsFor(entry.taskClass)) continue;
      const similarity = cosineSimilarity(embedding, entry.embedding);
      if (!best || similarity > best.similarity) best = { entry, similarity };
    }

    if (!best || best.similarity < this.threshold) return { hit: false };
    return {
      hit: true,
      role: best.entry.role,
      taskClass: best.entry.taskClass,
      paidProviderPreference: best.entry.paidProviderPreference,
      similarity: best.similarity,
    };
  }

  async set(packet: TaskPacket, role: ModelRole, provider?: ExecutorName): Promise<void> {
    if (!this.canUse(packet)) return;
    const l1 = classifyTaskHeuristic(packet);
    const signature = routeSignature(packet);
    const embedding = await this.embedSafe(signature);
    if (!embedding) return;
    const entry: RouteDecisionCacheEntry = {
      key: `${packet.node_type}:${l1.taskClass}:${signature}`,
      nodeType: packet.node_type,
      taskClass: l1.taskClass,
      role,
      paidProviderPreference: paidProviderPreference(provider),
      embedding,
      createdAtMs: this.now(),
    };
    const existing = this.entries.findIndex((candidate) => candidate.key === entry.key);
    if (existing >= 0) this.entries[existing] = entry;
    else this.entries.push(entry);
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

export function routeSignature(packet: TaskPacket): string {
  return JSON.stringify({
    node_type: packet.node_type,
    intent: packet.intent.toLowerCase().replace(/\s+/g, " ").trim(),
    context: routeContext(packet.context),
  });
}

export function paidProviderPreference(provider?: ExecutorName): "gpt" | "claude" | undefined {
  return provider === "gpt" || provider === "claude" ? provider : undefined;
}

function routeContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (key === "routing" || key === "conversationId") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null) out[key] = value;
  }
  return out;
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

function resolveThreshold(option?: number): number {
  const raw = option ?? Number(process.env.SPECTRA_ROUTE_CACHE_THRESHOLD ?? "0.9");
  return Number.isFinite(raw) ? clamp(raw, 0, 1) : 0.9;
}

function ttlMsFor(taskClass: TaskClass): number {
  const envKey = `SPECTRA_ROUTE_CACHE_TTL_${taskClass.toUpperCase()}`;
  const seconds = Number(process.env[envKey] ?? DEFAULT_TTL_SECONDS[taskClass]);
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TTL_SECONDS[taskClass];
  return safeSeconds * 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
