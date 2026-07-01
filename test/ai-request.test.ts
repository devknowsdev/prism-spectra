process.env.AI_FORGE_MOCK_EXECUTORS = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyProviderProbe } from "../src/config/providerProbe.js";
import { ExecutionEngine, normalizeAiRequestBody } from "../src/index.js";
import { buildTaskPrompt } from "../src/executors/aiPrompt.js";
import { FOCUS_CHAT_RESPONSE_SCHEMA, OllamaExecutor } from "../src/executors/ollama.js";
import type { ExecutionResult, TaskPacket } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", ".test-tmp", "ai-request");

function focusChatRequest(prompt: string, extraInput: Record<string, unknown> = {}) {
  const request = normalizeAiRequestBody({
    sourceApp: "prism-focus",
    intent: "focus-chat-message",
    riskClass: "read-only",
    preferredMode: "local-first",
    aiRole: "planner",
    maxOutputTokens: 900,
    record: false,
    input: {
      prompt,
      instruction: "Return ONLY valid JSON with this shape: { reply, proposedTasks, proposedSchedule, followUpQuestion }",
      ...extraInput,
    },
    context: {
      feature: "focus-chat",
      appSurface: "chat-modal",
    },
  });
  assert.equal(request.ok, true);
  if (!request.ok) throw new Error("expected focus chat request");
  return request.request;
}

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });

  const invalid = normalizeAiRequestBody({
    sourceApp: "prism-focus",
    intent: "Request a non-read-only action",
    riskClass: "local-write",
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error, /riskClass=read-only/);

  const invalidRole = normalizeAiRequestBody({
    sourceApp: "prism-focus",
    intent: "Bad role smoke",
    riskClass: "read-only",
    aiRole: "ui",
  });
  assert.equal(invalidRole.ok, false);
  if (!invalidRole.ok) assert.match(invalidRole.error, /aiRole/);

  const valid = normalizeAiRequestBody({
    sourceApp: "prism-focus",
    intent: "Suggest a calm daily plan",
    riskClass: "read-only",
    input: { energy: 3, scheduledCount: 2 },
    context: { appSurface: "daily-plan" },
  });
  assert.equal(valid.ok, true);
  if (!valid.ok) throw new Error("expected valid request");

  const classifierSmoke = normalizeAiRequestBody({
    sourceApp: "prism-focus",
    intent: "Tiny Settings smoke test",
    riskClass: "read-only",
    aiRole: "classifier",
    maxOutputTokens: 80,
    record: false,
    input: { prompt: "Reply with one sentence." },
    context: { appSurface: "settings" },
  });
  assert.equal(classifierSmoke.ok, true);
  if (!classifierSmoke.ok) throw new Error("expected classifier smoke request");
  assert.equal(classifierSmoke.request.aiRole, "classifier");
  assert.equal(classifierSmoke.request.maxOutputTokens, 80);
  assert.equal(classifierSmoke.request.record, false);

  const engine = new ExecutionEngine({
    dbPath: path.join(ROOT, "gateway.db"),
    workDir: path.join(ROOT, "work"),
    mockExecutors: true,
    ollamaSwapDelayMs: 1,
  });
  await engine.init();

  engine.ledger.setBudget("ollama", { rpmLimit: 0 });
  assert.equal(engine.ledger.check("ollama").allowed, false);
  applyProviderProbe(engine, [{ provider: "ollama", available: true }]);
  assert.equal(engine.ledger.check("ollama").allowed, true, "available Ollama probe should clear stale rpmLimit=0 block");

  const result = await engine.runAiRequest(valid.request);
  assert.equal(result.ok, true);
  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "qwen3.5:9b");
  assert.equal(result.dataBoundary, "local");
  assert.match(result.response, /ollama:mock/);
  assert.equal(result.provenance.routedBy, "prism-spectra");
  assert.equal(result.provenance.sourceApp, "prism-focus");
  assert.equal(result.provenance.riskClass, "read-only");
  assert.equal(result.provenance.recorded, true);
  assert.ok(result.usage.tokensIn > 0);
  assert.ok(result.usage.tokensOut > 0);

  const smokeResult = await engine.runAiRequest(classifierSmoke.request);
  assert.equal(smokeResult.ok, true);
  assert.equal(smokeResult.provider, "ollama");
  assert.equal(smokeResult.model, "qwen3:1.7b");
  assert.equal(smokeResult.provenance.recorded, false);

  const focusChatResult = await engine.runAiRequest(focusChatRequest("what can you do?"));
  assert.equal(focusChatResult.ok, true);
  assert.equal(focusChatResult.provider, "ollama");
  assert.equal(focusChatResult.model, "qwen3.5:9b");
  assert.equal(focusChatResult.provenance.recorded, false);
  assert.equal(typeof focusChatResult.structuredResponse, "object");
  assert.ok(focusChatResult.structuredResponse);
  assert.match((focusChatResult.structuredResponse as any).reply, /choose a next task/);
  assert.deepEqual((focusChatResult.structuredResponse as any).proposedTasks, []);
  assert.deepEqual((focusChatResult.structuredResponse as any).proposedSchedule, []);

  const overwhelmResult = await engine.runAiRequest(focusChatRequest(
    "I have four tasks and feel overloaded. Help me choose one.",
    { currentFocusState: { taskCount: 4, openTaskCount: 4, currentFocusTask: "" } }
  ));
  assert.equal(overwhelmResult.ok, true);
  assert.match((overwhelmResult.structuredResponse as any).reply, /4 open tasks/);
  assert.match((overwhelmResult.structuredResponse as any).reply, /low-overwhelm next move/);
  assert.equal((overwhelmResult.structuredResponse as any).proposedTasks.length, 1);
  assert.match((overwhelmResult.structuredResponse as any).followUpQuestion, /four task names/);

  const breakdownResult = await engine.runAiRequest(focusChatRequest("Break down sort my admin into tiny steps."));
  assert.equal(breakdownResult.ok, true);
  assert.ok((breakdownResult.structuredResponse as any).proposedTasks.length >= 2);

  const scheduleResult = await engine.runAiRequest(focusChatRequest("Plan the next 90 minutes gently."));
  assert.equal(scheduleResult.ok, true);
  assert.ok((scheduleResult.structuredResponse as any).proposedSchedule.length >= 2);

  const focusInstruction =
    "Return ONLY valid JSON with this shape: { reply, proposedTasks, proposedSchedule, followUpQuestion }";
  const focusPacket: TaskPacket = {
    intent: "Read-only Prism AI request for Focus chat",
    node_type: "docs",
    dependencies: [],
    constraints: ["read-only", "no-app-mutation", "no-file-write"],
    context: {
      expectsJson: true,
      aiRequest: {
        sourceApp: "prism-focus",
        intent: "focus-chat-message",
        input: { prompt: "Help me choose one task.", instruction: focusInstruction },
        context: { feature: "focus-chat", appSurface: "chat-modal" },
      },
    },
  };
  const focusPrompt = buildTaskPrompt(focusPacket, []);
  assert.match(focusPrompt, new RegExp(focusInstruction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(focusPrompt, /Respond concisely with the result only/);
  assert.doesNotMatch(focusPrompt, /"instruction":/);

  const originalFetch = globalThis.fetch;
  let ollamaRequestBody: Record<string, unknown> | undefined;
  try {
    globalThis.fetch = async (_input, init) => {
      ollamaRequestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              reply: "Choose the easiest task to start.",
              proposedTasks: [],
              proposedSchedule: [],
              followUpQuestion: "",
            }),
          },
          prompt_eval_count: 12,
          eval_count: 8,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
    const realExecutorResult = await new OllamaExecutor().execute(focusPacket);
    assert.equal(realExecutorResult.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(ollamaRequestBody?.format, FOCUS_CHAT_RESPONSE_SCHEMA);
  assert.equal(ollamaRequestBody?.think, false);
  assert.match(
    String((ollamaRequestBody?.messages as Array<{ content?: string }> | undefined)?.[0]?.content),
    new RegExp(focusInstruction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );

  const summary = engine.taskHistory
    .dataBoundarySummary("ai-request:prism-focus")
    .map((row) => ({ ...row }));
  assert.deepEqual(summary, [{ dataBoundary: "local", count: 1 }]);

  engine.close();

  const cacheEngine = new ExecutionEngine({
    dbPath: path.join(ROOT, "cache-gateway.db"),
    workDir: path.join(ROOT, "cache-work"),
    mockExecutors: true,
    ollamaSwapDelayMs: 1,
  });
  await cacheEngine.init();
  const cacheInternals = cacheEngine as unknown as {
    executors: {
      ollama: { execute: (packet: TaskPacket) => Promise<ExecutionResult> };
    };
    fileLocks: { acquire: (paths?: string[]) => Promise<() => void> };
  };
  cacheInternals.fileLocks.acquire = async () => {
    throw new Error("runAiRequest must not acquire file locks");
  };
  let aiRequestExecutions = 0;
  let capturedAiRequestPacket: TaskPacket | undefined;
  cacheInternals.executors.ollama.execute = async (packet) => {
    aiRequestExecutions += 1;
    capturedAiRequestPacket = packet;
    return {
      success: true,
      output: "A stable read-only response that is long enough for normal confidence scoring.",
      provider: "ollama",
      tokensIn: 12,
      tokensOut: 18,
      cost: 0,
      latencyMs: 2,
      patch: {
        edits: [{ path: "must-not-be-written.txt", op: "write", content: "unsafe" }],
      },
    };
  };
  const cacheRequest = normalizeAiRequestBody({
    sourceApp: "prism-cache-test",
    intent: "repeatable-read-only-request",
    riskClass: "read-only",
    aiRole: "reasoner",
    maxOutputTokens: 321,
    record: true,
    input: { prompt: "Give me the same read-only answer." },
    context: { feature: "cache-contract" },
  });
  assert.equal(cacheRequest.ok, true);
  if (!cacheRequest.ok) throw new Error("expected cache request");
  const firstCacheResult = await cacheEngine.runAiRequest(cacheRequest.request);
  const secondCacheResult = await cacheEngine.runAiRequest(cacheRequest.request);
  assert.equal(firstCacheResult.ok, true);
  assert.equal(secondCacheResult.ok, true);
  assert.equal(aiRequestExecutions, 1, "second identical AI request should use the pattern cache");
  assert.equal(firstCacheResult.provenance.cacheHit, false);
  assert.equal(secondCacheResult.provenance.cacheHit, true);
  assert.equal(secondCacheResult.provenance.cacheHitKind, "exact");
  assert.equal(secondCacheResult.usage.latencyMs, 0);
  assert.equal(fs.existsSync(path.join(ROOT, "cache-work", "must-not-be-written.txt")), false);
  const capturedAiRequest =
    capturedAiRequestPacket?.context.aiRequest as Record<string, unknown> | undefined;
  assert.equal(capturedAiRequest?.aiRole, "reasoner");
  assert.equal(capturedAiRequest?.maxOutputTokens, 321);
  cacheEngine.close();

  const fallbackEngine = new ExecutionEngine({
    dbPath: path.join(ROOT, "fallback-gateway.db"),
    workDir: path.join(ROOT, "fallback-work"),
    mockExecutors: true,
    ollamaSwapDelayMs: 1,
    fallbackOnFailure: true,
    confidenceThreshold: 0.4,
  });
  await fallbackEngine.init();
  const fallbackInternals = fallbackEngine as unknown as {
    executors: {
      ollama: { execute: (packet: TaskPacket) => Promise<ExecutionResult> };
    };
  };
  fallbackInternals.executors.ollama.execute = async () => ({
    success: true,
    output: "I don't know",
    provider: "ollama",
    tokensIn: 5,
    tokensOut: 3,
    cost: 0,
    latencyMs: 1,
  });
  const fallbackRequest = normalizeAiRequestBody({
    sourceApp: "prism-focus",
    intent: "explain a complex failure",
    riskClass: "read-only",
    record: false,
    input: { prompt: "Explain this failure." },
  });
  assert.equal(fallbackRequest.ok, true);
  if (!fallbackRequest.ok) throw new Error("expected fallback request");
  const fallbackResult = await fallbackEngine.runAiRequest(fallbackRequest.request);
  assert.equal(fallbackResult.ok, true);
  assert.equal(fallbackResult.provider, "free_tier");
  assert.deepEqual(
    fallbackResult.provenance.chainTried.map(attempt => attempt.provider),
    ["ollama", "free_tier"]
  );
  fallbackEngine.close();

  console.log("  ok  - ai request gateway contract");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
