// Real Ollama executor — calls a local Ollama HTTP server.
// Falls back cleanly when the server is unreachable (router + CLI probe skip the tier).

import type { Executor, ExecutionResult, NodeType, TaskPacket } from "../types.js";
import { buildTaskPrompt, collectTargetFiles, patchFromFileResponse } from "./aiPrompt.js";

export type ModelRole = "classifier" | "coder" | "planner" | "reasoner" | "fallback";

export interface LocalModelEntry {
  ollamaModel: string;
  role: ModelRole;
  maxContext: number;
}

export const OLLAMA_CODER_MODEL = "qwen2.5-coder:7b";
export const OLLAMA_GENERAL_MODEL = "qwen3.5:9b";
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

export const MODEL_ROLES: readonly ModelRole[] = ["classifier", "coder", "planner", "reasoner", "fallback"] as const;

/**
 * Role-tagged local model catalog for Track A.
 * Defaults target the recommended local stack for an M1 16GB machine.
 * Each role can be overridden via OLLAMA_MODEL_<ROLE> env vars
 * (e.g. OLLAMA_MODEL_CODER=codellama:7b).
 * Do not confuse with src/config/modelRegistry.ts — that is Track B and excluded from build.
 */
export const LOCAL_MODEL_CATALOG: Record<ModelRole, LocalModelEntry> = {
  classifier: { ollamaModel: "qwen3:1.7b", role: "classifier", maxContext: 4096 },
  coder: { ollamaModel: "qwen2.5-coder:7b", role: "coder", maxContext: 8192 },
  planner: { ollamaModel: "qwen3.5:9b", role: "planner", maxContext: 256000 },
  reasoner: { ollamaModel: "qwen3.5:9b", role: "reasoner", maxContext: 256000 },
  fallback: { ollamaModel: "qwen3:1.7b", role: "fallback", maxContext: 4096 },
};

const ROLE_BY_NODE_TYPE: Record<string, ModelRole> = {
  ui: "coder",
  backend: "coder",
  tests: "coder",
  docs: "planner",
  terminal: "reasoner",
};

/**
 * Resolve the Ollama model string for a given role.
 * Checks OLLAMA_MODEL_<ROLE> env var first, then catalog default.
 */
export function selectModelForRole(role: ModelRole): string {
  const envKey = `OLLAMA_MODEL_${role.toUpperCase()}`;
  return process.env[envKey] ?? LOCAL_MODEL_CATALOG[role].ollamaModel;
}

const CODING_NODE_TYPES: ReadonlySet<NodeType> = new Set(["ui", "backend", "tests"]);

export function normalizeModelRole(value: unknown): ModelRole | null {
  return typeof value === "string" && MODEL_ROLES.includes(value as ModelRole) ? (value as ModelRole) : null;
}

export function modelRoleFromPacketContext(packet: TaskPacket): ModelRole | null {
  const context = packet.context ?? {};
  const routing = typeof context.routing === "object" && context.routing !== null ? (context.routing as Record<string, unknown>) : {};
  const aiRequest = typeof context.aiRequest === "object" && context.aiRequest !== null ? (context.aiRequest as Record<string, unknown>) : {};
  return (
    normalizeModelRole(context.aiRole) ??
    normalizeModelRole(routing.aiRole) ??
    normalizeModelRole(routing.modelRole) ??
    normalizeModelRole(aiRequest.aiRole)
  );
}

export function selectModel(packet: TaskPacket, opts?: { coderModel?: string; generalModel?: string }): string {
  const routedRole = modelRoleFromPacketContext(packet);
  if (routedRole) return selectModelForRole(routedRole);

  // Legacy env var / opts compat — Focus and CLI set OLLAMA_CODER_MODEL / OLLAMA_GENERAL_MODEL.
  // If either legacy override is active, use the original binary selection so nothing breaks.
  const legacyCoder = opts?.coderModel ?? process.env.OLLAMA_CODER_MODEL;
  const legacyGeneral = opts?.generalModel ?? process.env.OLLAMA_GENERAL_MODEL;
  if (legacyCoder || legacyGeneral) {
    const coder = legacyCoder ?? OLLAMA_CODER_MODEL;
    const general = legacyGeneral ?? OLLAMA_GENERAL_MODEL;
    return CODING_NODE_TYPES.has(packet.node_type) ? coder : general;
  }
  // Role-based selection via catalog.
  const role = ROLE_BY_NODE_TYPE[packet.node_type] ?? "planner";
  return selectModelForRole(role);
}

/**
 * Lightweight pre-classification call using the classifier-role model.
 * Calls Ollama directly (short timeout, small output limit).
 * Returns null on any failure — callers must handle null gracefully and fall back
 * to selectModel() without pre-classification.
 *
 * Tier 2b wiring must call this through LocalModelLock before execution because
 * it changes the active Ollama model context.
 */
export async function classifyIntent(
  intent: string,
  host = ollamaHost()
): Promise<{ role: ModelRole; reasoning: string } | null> {
  const model = selectModelForRole("classifier");
  const prompt = `You are a task classifier. Given a task intent, respond with ONLY a JSON object with no other text: {"role": "<coder|planner|reasoner|fallback>", "reasoning": "<one sentence>"}. Task: "${intent.slice(0, 500)}"`;

  try {
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: { num_predict: 80 },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { message?: { content?: string } };
    const text = (data.message?.content ?? "").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { role?: string; reasoning?: string };
    const role = normalizeModelRole(parsed.role);
    if (!role || role === "classifier") return null;
    return { role, reasoning: parsed.reasoning ?? "" };
  } catch {
    return null;
  }
}

export function ollamaHost(): string {
  return (process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST).replace(/\/$/, "");
}

export async function probeOllama(host = ollamaHost()): Promise<{ available: boolean; reason?: string }> {
  try {
    const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { available: false, reason: `Ollama responded ${response.status}` };
    return { available: true };
  } catch (err) {
    return { available: false, reason: (err as Error).message };
  }
}

export class OllamaExecutor implements Executor {
  readonly name = "ollama" as const;

  async execute(packet: TaskPacket): Promise<ExecutionResult> {
    const start = Date.now();
    const host = ollamaHost();
    const model = selectModel(packet);
    const requestedFiles = collectTargetFiles(packet);
    const prompt = buildTaskPrompt(packet, requestedFiles);
    const maxOutputTokens = outputTokenCapFromPacketContext(packet);

    try {
      const response = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          ...(maxOutputTokens ? { options: { num_predict: maxOutputTokens } } : {}),
        }),
        signal: AbortSignal.timeout(300_000),
      });

      if (!response.ok) {
        const text = await response.text();
        return fail(start, `Ollama error ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = (await response.json()) as {
        message?: { content?: string };
        eval_count?: number;
        prompt_eval_count?: number;
      };
      const outputText = data.message?.content ?? "";
      const tokensIn = data.prompt_eval_count ?? estimateTokens(prompt);
      const tokensOut = data.eval_count ?? estimateTokens(outputText);

      if (requestedFiles.length === 0) {
        return {
          success: true,
          output: outputText,
          provider: "ollama",
          tokensIn,
          tokensOut,
          cost: 0,
          latencyMs: Date.now() - start,
        };
      }

      const fileResult = patchFromFileResponse(outputText, requestedFiles);
      if (fileResult.error) {
        return {
          success: false,
          output: outputText,
          provider: "ollama",
          tokensIn,
          tokensOut,
          cost: 0,
          latencyMs: Date.now() - start,
          error: `ollama ${fileResult.error}`,
          patch: fileResult.patch,
        };
      }

      return {
        success: true,
        output: outputText,
        provider: "ollama",
        tokensIn,
        tokensOut,
        cost: 0,
        latencyMs: Date.now() - start,
        patch: fileResult.patch,
      };
    } catch (err) {
      return fail(start, `Ollama call failed: ${(err as Error).message}`);
    }
  }
}

function outputTokenCapFromPacketContext(packet: TaskPacket): number | undefined {
  const context = packet.context ?? {};
  const aiRequest = typeof context.aiRequest === "object" && context.aiRequest !== null ? (context.aiRequest as Record<string, unknown>) : {};
  const raw = aiRequest.maxOutputTokens ?? aiRequest.outputTokens ?? context.maxOutputTokens;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(1, Math.min(4096, Math.round(n)));
}

function fail(start: number, error: string): ExecutionResult {
  return {
    success: false,
    output: "",
    provider: "ollama",
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    latencyMs: Date.now() - start,
    error,
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}
