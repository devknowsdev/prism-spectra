process.env.AI_FORGE_MOCK_EXECUTORS = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ExecutionEngine } from "../src/engine/executionEngine.js";
import type { EmbeddingProvider } from "../src/embeddings/ollamaEmbeddings.js";
import type { TaskPacket } from "../src/types.js";

class KeywordEmbeddingProvider implements EmbeddingProvider {
  fail = false;

  async embed(input: string): Promise<number[] | null> {
    if (this.fail) return null;
    const text = input.toLowerCase();
    return [
      /explain|why|reason/.test(text) ? 1 : 0,
      /local|private|privacy/.test(text) ? 1 : 0,
      /routing|route|router/.test(text) ? 1 : 0,
      /function|typescript|code|api/.test(text) ? 1 : 0,
    ];
  }
}

function packet(intent: string, node_type: TaskPacket["node_type"] = "docs"): TaskPacket {
  return { intent, node_type, context: {}, constraints: [], dependencies: [] };
}

function makeEngine(provider: KeywordEmbeddingProvider) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-tier3b-engine-"));
  const engine = new ExecutionEngine({
    dbPath: path.join(root, "test.sqlite"),
    workDir: root,
    mockExecutors: true,
    semanticCacheEnabled: false,
    semanticEmbeddingProvider: provider,
    semanticEmbeddingKeepalive: false,
    routeDecisionCacheEnabled: true,
    routeDecisionCacheThreshold: 0.7,
  });
  return { engine, root };
}

function closeEngine(engine: ExecutionEngine, root: string): void {
  engine.close();
  fs.rmSync(root, { recursive: true, force: true });
}

let passed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
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
  await test("engine creates route decision cache when embedding provider is injected", () => {
    const provider = new KeywordEmbeddingProvider();
    const { engine, root } = makeEngine(provider);
    try {
      assert.ok(engine.routeDecisionCache);
    } finally {
      closeEngine(engine, root);
    }
  });

  await test("engine stores a route hint after a successful AI request", async () => {
    const provider = new KeywordEmbeddingProvider();
    const { engine, root } = makeEngine(provider);
    try {
      const result = await engine.runAiRequest({
        sourceApp: "tier3b-test",
        intent: "explain why local routing protects privacy",
        nodeType: "docs",
      });
      assert.equal(result.ok, true);

      const hit = await engine.routeDecisionCache?.get(packet("explain why private local router choices matter"));
      assert.equal(hit?.hit, true);
      assert.equal(hit?.role, "reasoner");
    } finally {
      closeEngine(engine, root);
    }
  });

  await test("similar later work surfaces a route hint through AI request routing", async () => {
    const provider = new KeywordEmbeddingProvider();
    const { engine, root } = makeEngine(provider);
    try {
      await engine.runAiRequest({
        sourceApp: "tier3b-test",
        intent: "explain why local routing protects privacy",
        nodeType: "docs",
      });

      const result = await engine.runAiRequest({
        sourceApp: "tier3b-test",
        intent: "explain why private local router choices matter",
        nodeType: "docs",
      });

      assert.equal(result.ok, true);
      assert.equal((result.provenance as any).routeCacheHit, true);
      assert.equal(result.provider, "ollama");
    } finally {
      closeEngine(engine, root);
    }
  });

  await test("route hint does not bypass local-first routing", async () => {
    const provider = new KeywordEmbeddingProvider();
    const { engine, root } = makeEngine(provider);
    try {
      await engine.routeDecisionCache?.set(packet("build a TypeScript API helper", "backend"), "coder", "gpt");

      const result = await engine.runAiRequest({
        sourceApp: "tier3b-test",
        intent: "build a TypeScript API helper",
        nodeType: "backend",
      });

      assert.equal(result.ok, true);
      assert.equal(result.provider, "ollama");
    } finally {
      closeEngine(engine, root);
    }
  });

  await test("embedding failure degrades to normal routing", async () => {
    const provider = new KeywordEmbeddingProvider();
    provider.fail = true;
    const { engine, root } = makeEngine(provider);
    try {
      const result = await engine.runAiRequest({
        sourceApp: "tier3b-test",
        intent: "explain why local routing protects privacy",
        nodeType: "docs",
      });

      assert.equal(result.ok, true);
      assert.equal(result.provider, "ollama");
    } finally {
      closeEngine(engine, root);
    }
  });

  if (!process.exitCode) console.log(`${passed} tier3b engine route hint test(s) passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
