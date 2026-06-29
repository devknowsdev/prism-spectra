// src/engine/executionEngine.ts
//
// Canonical node lifecycle (01_ARCHITECTURE.md / 05_EXECUTION_ENGINE.md /
// 12_FINAL_SYSTEM_SPEC.md), all docs describe the same sequence:
//
//   Node -> pattern cache check (06, skips AI call entirely on a hit)
//        -> check cost/quota ledger (06) -> route (03)
//        -> execute -> checkpoint (07) -> validate (07, automated)
//        -> commit (keep checkpoint) or rollback (revert checkpoint, mark
//           direct dependents blocked — 04)
//        -> store in Memory (06) -> feed learning loop (11, skipped on cache
//           hits — see below)
//
// Cache-hit specifics (judgment calls the spec doesn't spell out, flagged
// here rather than buried in code):
//   - Skipped entirely for node_type "terminal": shell commands are
//     side-effecting and not safely replayable from a cached "output", so
//     terminal nodes always execute for real.
//   - A hit skips ledger consumption (no call was made, so no RPM/RPD/$
//     spent) and skips validate()'s build/test re-run (the cached output
//     already passed validation when it was first stored — see
//     PatternCache.set, only ever called after a successful validate()).
//   - A hit is still git-checkpointed and written to task_history /
//     execution_logs (cache_hit=1, cost=0) so the audit trail and per-project
//     history stay complete, but it does NOT feed the learning loop —
//     crediting a provider with a free win it didn't actually do would
//     distort routing_weights' success/cost/latency averages.

import type { CacheHitKind, ExecutionMode, ExecutionResult, ExecutorName, NodeOutcome, TaskPacket } from "../types.js";
import { dataBoundaryFor } from "../types.js";
import { MemoryDB } from "../memory/db.js";
import { Ledger } from "../memory/ledger.js";
import { PatternCache, type CacheLookup } from "../memory/patternCache.js";
import { SemanticPatternCache } from "../memory/semanticPatternCache.js";
import { TaskHistory } from "../memory/taskHistory.js";
import { LearningLoop } from "../intelligence/learningLoop.js";
import { Router } from "../routing/router.js";
import { classifyTaskHeuristic, type L1Classification } from "../routing/l1Classifier.js";
import { buildExecutorRegistry } from "../executors/index.js";
import { TaskGraph } from "../taskGraph/graph.js";
import { CheckpointManager } from "../safety/checkpoint.js";
import { validate } from "../safety/validation.js";
import { applyPatch } from "../safety/patch.js";
import { FileLockManager } from "./fileLock.js";
import { LocalModelLock } from "./modelLock.js";
import {
  classifyIntent,
  modelRoleFromPacketContext,
  selectModel as selectOllamaModel,
  selectModelForRole,
  type ModelRole,
} from "../executors/ollama.js";
import { OllamaEmbeddingProvider, startEmbeddingKeepalive, type EmbeddingProvider } from "../embeddings/ollamaEmbeddings.js";
import {
  buildAiRequestIntent,
  parseStructuredResponse,
  type AiRequestInput,
  type AiRequestResult,
} from "./aiRequest.js";

export interface EngineOptions {
  dbPath: string;
  workDir: string;
  /** Real local hot-swap cost per Local_AI_Developer_Stack.docx is ~10s;
   *  defaults to that. Tests/demos override with a small value for speed —
   *  see modelLock.ts for why this exists at all. */
  ollamaSwapDelayMs?: number;
  /** Use mock executors (tests). */
  mockExecutors?: boolean;
  /** Retry the next tier when an executor call fails (CLI default: true). */
  fallbackOnFailure?: boolean;
  /** Use the short live Ollama classifier after L1 when confidence is low. Defaults off in mock mode. */
  useLiveOllamaClassifier?: boolean;
  /** Cascade quality-gate threshold for local confidence scoring. */
  confidenceThreshold?: number;
  /** Enable Layer B semantic cache. Defaults on for real executors, off for mocks unless a provider is injected. */
  semanticCacheEnabled?: boolean;
  /** Test/adapter injection point. Production defaults to Ollama /api/embed. */
  semanticEmbeddingProvider?: EmbeddingProvider;
  /** Semantic cache cosine threshold. Default 0.92. */
  semanticCacheThreshold?: number;
  /** Keep the embedding model warm. Defaults on for real executors. Timer is unref'd. */
  semanticEmbeddingKeepalive?: boolean;
}

export interface NodeRunLog {
  nodeId: string;
  status: "success" | "failed";
  provider: ExecutorName;
  cacheHit: boolean;
  cacheHitKind?: CacheHitKind;
  cost: number;
  latencyMs: number;
  error?: string;
  confidenceScore?: number | null;
  fallbackReason?: string;
  ledgerChainTried?: { provider: ExecutorName; allowed: boolean; reason?: string }[];
}

export class ExecutionEngine {
  readonly memory: MemoryDB;
  readonly ledger: Ledger;
  readonly patternCache: PatternCache;
  readonly semanticPatternCache?: SemanticPatternCache;
  readonly taskHistory: TaskHistory;
  readonly learningLoop: LearningLoop;
  readonly router: Router;
  readonly checkpoints: CheckpointManager;
  readonly modelLock: LocalModelLock;
  private executors = buildExecutorRegistry();
  private fileLocks = new FileLockManager();
  private workDir: string;
  private fallbackOnFailure: boolean;
  private useLiveOllamaClassifier: boolean;
  private confidenceThreshold: number;
  private embeddingProvider?: EmbeddingProvider;
  private embeddingKeepalive?: { stop: () => void };

  constructor(opts: EngineOptions) {
    this.workDir = opts.workDir;
    this.fallbackOnFailure = opts.fallbackOnFailure ?? false;
    const mockExecutors = opts.mockExecutors ?? process.env.AI_FORGE_MOCK_EXECUTORS === "1";
    this.useLiveOllamaClassifier = opts.useLiveOllamaClassifier ?? !mockExecutors;
    this.confidenceThreshold = resolveConfidenceThreshold(opts.confidenceThreshold);
    this.memory = new MemoryDB(opts.dbPath);
    this.ledger = new Ledger(this.memory);
    this.patternCache = new PatternCache(this.memory);
    const semanticEnabled = opts.semanticCacheEnabled ?? (Boolean(opts.semanticEmbeddingProvider) || !mockExecutors);
    if (semanticEnabled) {
      this.embeddingProvider = opts.semanticEmbeddingProvider ?? new OllamaEmbeddingProvider();
      this.semanticPatternCache = new SemanticPatternCache({
        provider: this.embeddingProvider,
        similarityThreshold: opts.semanticCacheThreshold,
      });
      const keepWarm = opts.semanticEmbeddingKeepalive ?? !mockExecutors;
      if (keepWarm) {
        this.embeddingKeepalive = startEmbeddingKeepalive(this.embeddingProvider);
      }
    }
    this.taskHistory = new TaskHistory(this.memory);
    this.learningLoop = new LearningLoop(this.memory);
    this.router = new Router(this.ledger, this.learningLoop);
    this.checkpoints = new CheckpointManager(this.workDir);
    this.modelLock = new LocalModelLock(opts.ollamaSwapDelayMs);
    this.executors = buildExecutorRegistry({ mock: mockExecutors });
  }

  async init(): Promise<void> {
    await this.checkpoints.init();
  }

  async runAiRequest(request: AiRequestInput): Promise<AiRequestResult> {
    const sourceApp = request.sourceApp.trim() || "unknown";
    const riskClass = request.riskClass ?? "read-only";
    const preferredMode = request.preferredMode ?? "local-first";
    const graphId = `ai-request-${sourceApp}-${Date.now()}`;
    const nodeId = "request";
    const packet: TaskPacket = {
      intent: buildAiRequestIntent({ ...request, sourceApp, riskClass, preferredMode }),
      node_type: request.nodeType ?? "docs",
      dependencies: [],
      constraints: ["read-only", "no-app-mutation", "no-file-write"],
      context: {
        aiRequest: {
          sourceApp,
          intent: request.intent,
          riskClass,
          input: request.input ?? {},
          context: request.context ?? {},
          preferredMode,
        },
        ...(request.conversationId == null ? {} : { conversationId: request.conversationId }),
      },
    };

    const decision = this.router.route(packet);
    const provenanceBase = {
      routedBy: "prism-spectra" as const,
      sourceApp,
      riskClass,
      preferredMode,
      graphId,
      nodeId,
      recorded: false,
      chainTried: decision.chainTried,
    };

    if (!decision.executor) {
      return {
        ok: false,
        provider: null,
        model: null,
        response: "",
        error: `no executor within budget; tried: ${JSON.stringify(decision.chainTried)}`,
        provenance: provenanceBase,
      };
    }

    let result: ExecutionResult;
    try {
      result = await this.executeViaRoute(packet, decision.executor);
    } catch (error) {
      return {
        ok: false,
        provider: decision.executor,
        model: decision.executor === "ollama" ? selectOllamaModel(packet) : null,
        dataBoundary: dataBoundaryFor(decision.executor),
        response: "",
        error: (error as Error).message,
        provenance: provenanceBase,
      };
    }

    const safeResult: ExecutionResult = { ...result, patch: undefined };
    this.ledger.recordUsage(safeResult.provider, { cost: safeResult.cost });

    const outcome: NodeOutcome = {
      projectId: `ai-request:${sourceApp}`,
      graphId,
      nodeId,
      nodeType: packet.node_type,
      intent: request.intent,
      provider: safeResult.provider,
      dataBoundary: dataBoundaryFor(safeResult.provider),
      result: safeResult,
    };

    const shouldRecord = request.record !== false;
    if (shouldRecord) {
      this.taskHistory.recordOutcome(outcome);
      this.learningLoop.recordOutcome(outcome);
      this.recordConversationMessage(packet, outcome, safeResult);
    }

    const provenance = {
      ...provenanceBase,
      recorded: shouldRecord,
      chainTried: decision.chainTried,
    };
    const usage = {
      tokensIn: safeResult.tokensIn,
      tokensOut: safeResult.tokensOut,
      cost: safeResult.cost,
      latencyMs: safeResult.latencyMs,
    };
    const model = safeResult.provider === "ollama" ? selectOllamaModel(packet) : null;

    if (!safeResult.success) {
      return {
        ok: false,
        provider: safeResult.provider,
        model,
        dataBoundary: outcome.dataBoundary,
        response: safeResult.output,
        error: safeResult.error ?? "AI request failed",
        provenance,
        usage,
      };
    }

    return {
      ok: true,
      provider: safeResult.provider,
      model,
      dataBoundary: outcome.dataBoundary,
      response: safeResult.output,
      structuredResponse: parseStructuredResponse(safeResult.output),
      provenance,
      usage,
    };
  }

  async run(graph: TaskGraph, mode: ExecutionMode = "sequential"): Promise<NodeRunLog[]> {
    const logs: NodeRunLog[] = [];
    if (mode === "sequential") {
      while (!graph.isSettled()) {
        const ready = graph.readyNodeIds();
        if (ready.length === 0) break;
        logs.push(await this.runNode(graph, ready[0]));
      }
    } else {
      // parallel & optimized: run every currently-ready node concurrently.
      // "optimized" is currently an alias for "parallel" — true cost/latency-
      // aware scheduling (e.g. prioritizing cheap nodes first under a shared
      // budget) is future scope; flagging rather than pretending it's done.
      while (!graph.isSettled()) {
        const ready = graph.readyNodeIds();
        if (ready.length === 0) break;
        const batch = await Promise.all(ready.map((id) => this.runNode(graph, id)));
        logs.push(...batch);
      }
    }
    return logs;
  }

  private async runNode(graph: TaskGraph, nodeId: string): Promise<NodeRunLog> {
    const node = graph.get(nodeId);
    graph.setStatus(nodeId, "running");
    const packet = node.packet;

    const release = await this.fileLocks.acquire(packet.filePaths);
    try {
      let result: ExecutionResult;
      let chainTried: NodeRunLog["ledgerChainTried"];

      const cacheable = packet.node_type !== "terminal";
      const cacheLookup = cacheable ? await this.lookupCache(packet) : { hit: false as const };

      if (cacheLookup.hit) {
        result = {
          success: true,
          output: cacheLookup.output!,
          provider: cacheLookup.originProvider!,
          tokensIn: cacheLookup.originTokensIn ?? 0,
          tokensOut: cacheLookup.originTokensOut ?? 0,
          cost: 0,
          latencyMs: 0,
          cacheHit: true,
          cacheHitKind: cacheLookup.semantic ? "semantic" : "exact",
          patch: cacheLookup.originPatch,
        };
      } else {
        let decision = this.router.route(packet);
        chainTried = decision.chainTried;

        if (!decision.executor) {
          result = {
            success: false,
            output: "",
            provider: "ollama",
            tokensIn: 0,
            tokensOut: 0,
            cost: 0,
            latencyMs: 0,
            error: `no executor within budget; tried: ${JSON.stringify(decision.chainTried)}`,
          };
        } else {
          const tried: ExecutorName[] = [];
          result = await this.executeViaRoute(packet, decision.executor);

          while (this.fallbackOnFailure && decision.executor) {
            const lowConfidenceReason = this.lowConfidenceFallbackReason(result);
            if (result.success && !lowConfidenceReason) break;

            const previousError = result.error;
            if (lowConfidenceReason) {
              result = { ...result, fallbackReason: lowConfidenceReason };
            }

            tried.push(decision.executor);
            decision = this.router.route(packet, tried);
            chainTried = [...(chainTried ?? []), ...decision.chainTried];
            if (!decision.executor) break;
            const retry = await this.executeViaRoute(packet, decision.executor);
            result = {
              ...retry,
              fallbackReason: lowConfidenceReason ?? retry.fallbackReason,
              error: previousError && !lowConfidenceReason ? `${previousError}; then ${retry.error ?? "failed"}` : retry.error,
            };
          }

          this.ledger.recordUsage(result.provider, { cost: result.cost });
        }
      }

      // Diff-based patching (07): apply any proposed file edits to the
      // working tree BEFORE checkpointing — the checkpoint commit captures
      // whatever's on disk, so applying has to happen first. A bad patch
      // (e.g. a path escaping workDir) is a failure of THIS node, not a
      // crash of the engine — same fail/rollback path as any other error.
      if (result.patch) {
        try {
          applyPatch(this.workDir, result.patch);
        } catch (err) {
          result = { ...result, success: false, error: `patch application failed: ${(err as Error).message}` };
        }
      }

      const checkpointResult = await this.checkpoints.checkpoint(
        nodeId,
        result.patch?.edits.map((e) => e.path)
      );
      // Persist checkpoint sha for durability so rollbacks can be requested
      try {
        this.memory.db
          .prepare(`
            INSERT INTO checkpoints (project_id, graph_id, node_id, sha, had_changes)
            VALUES (?, ?, ?, ?, ?)
          `)
          .run(graph.projectId, graph.id, nodeId, checkpointResult.sha, checkpointResult.hadChanges ? 1 : 0);
      } catch (e) {
        console.warn("Failed to persist checkpoint record", e);
      }
      const validation = result.cacheHit ? { passed: true } : await validate(packet, result, this.workDir);

      if (validation.passed) {
        graph.setStatus(nodeId, "success");
        node.result = result;
        if (!result.cacheHit) {
          this.patternCache.set(packet, result.output, result.provider, result.tokensIn, result.tokensOut, result.patch);
          await this.semanticPatternCache?.set(packet, result.output, result.provider, result.tokensIn, result.tokensOut, result.patch);
        }
      } else {
        await this.checkpoints.rollback(nodeId);
        result = { ...result, success: false, error: result.error ?? validation.reason };
        node.result = result;
        graph.markFailed(nodeId); // marks direct dependents 'blocked' — see TaskGraph docblock
      }

      const outcome: NodeOutcome = {
        projectId: graph.projectId,
        graphId: graph.id,
        nodeId,
        nodeType: packet.node_type,
        intent: packet.intent,
        provider: result.provider,
        dataBoundary: dataBoundaryFor(result.provider),
        result,
      };
      this.taskHistory.recordOutcome(outcome);

      if (!result.cacheHit) {
        this.learningLoop.recordOutcome(outcome);
      }

      // If the packet was part of a conversation, persist the AI response
      // into the messages table for provenance/history. This is optional and
      // only runs when `packet.context.conversationId` is provided by the
      // caller (e.g. the UI or adapter). Keeping this optional avoids
      // forcing conversation semantics on every node.
      this.recordConversationMessage(packet, outcome, result);

      return {
        nodeId,
        status: result.success ? "success" : "failed",
        provider: result.provider,
        cacheHit: !!result.cacheHit,
        cacheHitKind: result.cacheHitKind,
        cost: result.cost,
        latencyMs: result.latencyMs,
        error: result.error,
        confidenceScore: result.confidenceScore,
        fallbackReason: result.fallbackReason,
        ledgerChainTried: chainTried,
      };
    } finally {
      release();
    }
  }

  close(): void {
    this.embeddingKeepalive?.stop();
    this.embeddingProvider?.close?.();
    this.memory.close();
  }

  private async lookupCache(packet: TaskPacket): Promise<CacheLookup & { semantic?: true }> {
    const exact = this.patternCache.get(packet);
    if (exact.hit) return exact;
    const semantic = await this.semanticPatternCache?.get(packet);
    return semantic?.hit ? semantic : { hit: false };
  }

  private recordConversationMessage(packet: TaskPacket, outcome: NodeOutcome, result: ExecutionResult): void {
    try {
      const convId = (packet.context && (packet.context as any).conversationId) || null;
      if (!convId) return;

      const promptText = typeof outcome.intent === "string" ? outcome.intent : JSON.stringify(outcome.intent || "");
      const responseText = result.output ?? "";
      const modelName = outcome.provider === "ollama" ? selectOllamaModel(packet) : null;
      try {
        this.memory.db
          .prepare(`
            INSERT INTO messages (conversation_id, role, provider, model, prompt, response, response_sha, attachments)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(convId, "assistant", outcome.provider, modelName, promptText, responseText, null, null);
      } catch (e) {
        console.warn("Failed to write message to DB", e);
      }
    } catch (e) {
      /* no-op */
    }
  }

  private async executeViaRoute(packet: TaskPacket, executor: ExecutorName): Promise<ExecutionResult> {
    const effectivePacket: TaskPacket =
      executor === "terminal"
        ? { ...packet, context: { ...packet.context, cwd: packet.context.cwd ?? this.workDir } }
        : packet;

    if (executor === "ollama") {
      const routedPacket = await this.prepareOllamaPacket(effectivePacket);
      const model = selectOllamaModel(routedPacket);
      return this.modelLock.run(model, async () => {
        const result = await this.executors.ollama.execute(routedPacket);
        return this.scoreLocalResult(routedPacket, result);
      });
    }
    return this.executors[executor].execute(effectivePacket);
  }

  private async prepareOllamaPacket(packet: TaskPacket): Promise<TaskPacket> {
    const explicitRole = modelRoleFromPacketContext(packet);
    const l1 = classifyTaskHeuristic(packet);
    let selectedRole: ModelRole = explicitRole ?? l1.role;
    let classifierResult: { role: ModelRole; reasoning: string } | null = null;

    if (!explicitRole && this.useLiveOllamaClassifier && l1.confidence < 0.85) {
      classifierResult = await this.modelLock.run(selectModelForRole("classifier"), () => classifyIntent(packet.intent));
      if (classifierResult) selectedRole = classifierResult.role;
    }

    const priorRouting =
      typeof packet.context.routing === "object" && packet.context.routing !== null
        ? (packet.context.routing as Record<string, unknown>)
        : {};

    return {
      ...packet,
      context: {
        ...packet.context,
        aiRole: selectedRole,
        routing: {
          ...priorRouting,
          aiRole: selectedRole,
          modelRole: selectedRole,
          l1,
          classifier: classifierResult,
        },
      },
    };
  }

  private scoreLocalResult(packet: TaskPacket, result: ExecutionResult): ExecutionResult {
    return { ...result, confidenceScore: scoreLocalConfidence(packet, result) };
  }

  private lowConfidenceFallbackReason(result: ExecutionResult): string | null {
    if (!result.success || result.provider !== "ollama") return null;
    if (typeof result.confidenceScore !== "number") return null;
    if (result.confidenceScore >= this.confidenceThreshold) return null;
    return `local confidence ${result.confidenceScore.toFixed(2)} below threshold ${this.confidenceThreshold.toFixed(2)}`;
  }
}

function scoreLocalConfidence(packet: TaskPacket, result: ExecutionResult): number {
  if (!result.success) return 0;
  const output = result.output.trim();
  if (!output) return 0.05;

  let score = 0.72;
  const l1 = readL1(packet);
  if (l1) score += (l1.confidence - 0.5) * 0.2;

  if (/\b(i am not sure|i'm not sure|i do not know|i don't know|cannot determine|unable to determine)\b/i.test(output)) {
    score -= 0.45;
  }
  if (/\b(todo|tbd|placeholder|lorem ipsum|fixme)\b/i.test(output)) {
    score -= 0.25;
  }
  if (result.tokensOut < 8 && packet.node_type !== "terminal") {
    score -= 0.2;
  }
  if (result.tokensOut > 80) {
    score += 0.05;
  }

  return clamp(score, 0, 1);
}

function readL1(packet: TaskPacket): L1Classification | null {
  const routing = typeof packet.context.routing === "object" && packet.context.routing !== null ? (packet.context.routing as Record<string, unknown>) : null;
  const l1 = routing?.l1;
  if (!l1 || typeof l1 !== "object") return null;
  const confidence = Number((l1 as { confidence?: unknown }).confidence);
  if (!Number.isFinite(confidence)) return null;
  return { ...(l1 as L1Classification), confidence };
}

function resolveConfidenceThreshold(option?: number): number {
  const raw = option ?? Number(process.env.SPECTRA_CONFIDENCE_THRESHOLD ?? "0.4");
  return Number.isFinite(raw) ? clamp(raw, 0, 1) : 0.4;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
