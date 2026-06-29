process.env.AI_FORGE_MOCK_EXECUTORS = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionEngine, normalizeAiRequestBody } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", ".test-tmp", "ai-request");

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

  const valid = normalizeAiRequestBody({
    sourceApp: "prism-focus",
    intent: "Suggest a calm daily plan",
    riskClass: "read-only",
    input: { energy: 3, scheduledCount: 2 },
    context: { appSurface: "daily-plan" },
  });
  assert.equal(valid.ok, true);
  if (!valid.ok) throw new Error("expected valid request");

  const engine = new ExecutionEngine({
    dbPath: path.join(ROOT, "gateway.db"),
    workDir: path.join(ROOT, "work"),
    mockExecutors: true,
    ollamaSwapDelayMs: 1,
  });
  await engine.init();

  const result = await engine.runAiRequest(valid.request);
  assert.equal(result.ok, true);
  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "qwen3:8b"); // planner role per LOCAL_MODEL_CATALOG (Tier 2a); was stale at "qwen3:9b" (legacy OLLAMA_GENERAL_MODEL constant) — pre-existing, unrelated to aiRole changes
  assert.equal(result.dataBoundary, "local");
  assert.match(result.response, /ollama:mock/);
  assert.equal(result.provenance.routedBy, "prism-spectra");
  assert.equal(result.provenance.sourceApp, "prism-focus");
  assert.equal(result.provenance.riskClass, "read-only");
  assert.equal(result.provenance.recorded, true);
  assert.ok(result.usage.tokensIn > 0);
  assert.ok(result.usage.tokensOut > 0);

  const summary = engine.taskHistory
    .dataBoundarySummary("ai-request:prism-focus")
    .map((row) => ({ ...row }));
  assert.deepEqual(summary, [{ dataBoundary: "local", count: 1 }]);

  // aiRole end-to-end: a request tagged nodeType "ui" (which alone would
  // resolve to the coder model) should resolve to the classifier model when
  // an explicit aiRole is set — this is the fix for Focus's chat bridge,
  // which previously tagged conversational chat messages as nodeType "ui"
  // with no way to say "this isn't code, route it as a lightweight helper".
  const withAiRole = normalizeAiRequestBody({
    sourceApp: "prism-focus",
    intent: "Chat message from Focus Assistant",
    riskClass: "read-only",
    nodeType: "ui",
    aiRole: "classifier",
    input: { prompt: "what can you do in this app?" },
  });
  assert.equal(withAiRole.ok, true);
  if (!withAiRole.ok) throw new Error("expected valid request");
  assert.equal(withAiRole.request.aiRole, "classifier");

  const roleResult = await engine.runAiRequest(withAiRole.request);
  assert.equal(roleResult.ok, true);
  assert.equal(roleResult.model, "phi3:mini"); // classifier role per LOCAL_MODEL_CATALOG, not the coder model nodeType "ui" would otherwise select

  const invalidRole = normalizeAiRequestBody({
    sourceApp: "prism-focus",
    intent: "x",
    riskClass: "read-only",
    aiRole: "coder", // coder is reserved for code-graph nodes, not the ai/request endpoint
  });
  assert.equal(invalidRole.ok, false);
  if (!invalidRole.ok) assert.match(invalidRole.error, /aiRole must be one of/);

  engine.close();
  console.log("  ok  - ai request gateway contract");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
