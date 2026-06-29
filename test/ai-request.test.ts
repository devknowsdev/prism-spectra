process.env.AI_FORGE_MOCK_EXECUTORS = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyProviderProbe } from "../src/config/providerProbe.js";
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

  const summary = engine.taskHistory
    .dataBoundarySummary("ai-request:prism-focus")
    .map((row) => ({ ...row }));
  assert.deepEqual(summary, [{ dataBoundary: "local", count: 1 }]);

  engine.close();
  console.log("  ok  - ai request gateway contract");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
