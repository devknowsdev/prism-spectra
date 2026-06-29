process.env.AI_FORGE_MOCK_EXECUTORS = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionEngine, TaskGraph, classifyTaskHeuristic } from "../src/index.js";
import { selectModel as selectOllamaModel } from "../src/executors/ollama.js";
import type { ExecutionResult, TaskPacket } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", ".test-tmp", "tier2b-routing");

function packet(p: Partial<TaskPacket> & Pick<TaskPacket, "intent" | "node_type">): TaskPacket {
  return { context: {}, constraints: [], dependencies: [], ...p };
}

async function freshEngine(name: string, opts: { fallbackOnFailure?: boolean; confidenceThreshold?: number } = {}): Promise<ExecutionEngine> {
  const dir = path.join(ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const engine = new ExecutionEngine({
    dbPath: path.join(dir, "forge.db"),
    workDir: path.join(dir, "workspace"),
    mockExecutors: true,
    ollamaSwapDelayMs: 1,
    fallbackOnFailure: opts.fallbackOnFailure,
    confidenceThreshold: opts.confidenceThreshold,
  });
  await engine.init();
  return engine;
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    console.error(`FAIL  - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true });

  await test("L1 classifier recognizes code-shaped work", async () => {
    const result = classifyTaskHeuristic(packet({ intent: "write a TypeScript function to parse CSV rows", node_type: "docs" }));
    assert.equal(result.taskClass, "code");
    assert.equal(result.role, "coder");
    assert.ok(result.confidence > 0.5, `expected useful confidence, got ${result.confidence}`);
  });

  await test("L1 classifier recognizes reasoning-shaped work", async () => {
    const result = classifyTaskHeuristic(packet({ intent: "explain why this architecture has trade-offs", node_type: "docs" }));
    assert.equal(result.taskClass, "reasoning");
    assert.equal(result.role, "reasoner");
    assert.ok(result.confidence > 0.5, `expected useful confidence, got ${result.confidence}`);
  });

  await test("selectModel honors explicit aiRole before node-type routing", async () => {
    const p = packet({ intent: "short classify call", node_type: "backend", context: { aiRole: "classifier" } });
    assert.equal(selectOllamaModel(p), "qwen3:1.7b");
  });

  await test("selectModel ignores invalid aiRole and falls back safely", async () => {
    const p = packet({ intent: "backend work", node_type: "backend", context: { aiRole: "not-a-role" } });
    assert.equal(selectOllamaModel(p), "qwen2.5-coder:7b");
  });

  await test("L1 routing can move a docs node onto the coder model", async () => {
    const engine = await freshEngine("l1-docs-to-coder");
    const graph = new TaskGraph("g", "p", [
      { id: "n", packet: packet({ intent: "write a TypeScript function for sorting tasks", node_type: "docs" }) },
    ]);
    await engine.run(graph, "sequential");
    assert.match(graph.get("n").result?.output ?? "", /qwen2\.5-coder:7b/);
    engine.close();
  });

  await test("router provider availability skips unavailable Ollama tier", async () => {
    const engine = await freshEngine("provider-availability");
    engine.router.setProviderAvailability("ollama", { available: false, reason: "test unavailable" });
    const graph = new TaskGraph("g", "p", [{ id: "n", packet: packet({ intent: "plain docs", node_type: "docs" }) }]);
    const [log] = await engine.run(graph, "sequential");
    assert.equal(log.provider, "free_tier");
    assert.equal(log.ledgerChainTried?.[0]?.provider, "ollama");
    assert.equal(log.ledgerChainTried?.[0]?.allowed, false);
    assert.match(log.ledgerChainTried?.[0]?.reason ?? "", /test unavailable/);
    engine.close();
  });

  await test("low local confidence escalates when fallbackOnFailure is enabled", async () => {
    const engine = await freshEngine("low-confidence", { fallbackOnFailure: true, confidenceThreshold: 0.4 });
    const ollama = (engine as unknown as { executors: { ollama: { execute: (p: TaskPacket) => Promise<ExecutionResult> } } }).executors.ollama;
    ollama.execute = async () => ({
      success: true,
      output: "I don't know",
      provider: "ollama",
      tokensIn: 5,
      tokensOut: 3,
      cost: 0,
      latencyMs: 1,
    });
    const graph = new TaskGraph("g", "p", [{ id: "n", packet: packet({ intent: "explain a complex failure", node_type: "docs" }) }]);
    const [log] = await engine.run(graph, "sequential");
    assert.equal(log.provider, "free_tier");
    assert.match(log.fallbackReason ?? "", /local confidence/);
    engine.close();
  });

  if (process.exitCode) return;
  console.log(`${passed} tier2b routing test(s) passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
