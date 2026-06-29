process.env.AI_FORGE_MOCK_EXECUTORS = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionEngine, SemanticPatternCache, TaskGraph } from "../src/index.js";
import type { EmbeddingProvider } from "../src/embeddings/ollamaEmbeddings.js";
import type { TaskPacket } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", ".test-tmp", "tier3a-semantic-cache");

function packet(p: Partial<TaskPacket> & Pick<TaskPacket, "intent" | "node_type">): TaskPacket {
  return { context: {}, constraints: [], dependencies: [], ...p };
}

class KeywordEmbeddingProvider implements EmbeddingProvider {
  calls = 0;
  fail = false;

  async embed(input: string): Promise<number[] | null> {
    this.calls++;
    if (this.fail) return null;
    const text = input.toLowerCase();
    return [
      /explain|why|reason/.test(text) ? 1 : 0,
      /local|private|privacy/.test(text) ? 1 : 0,
      /routing|route|router/.test(text) ? 1 : 0,
      /write|file|patch|component/.test(text) ? 1 : 0,
      /music|creative|story/.test(text) ? 1 : 0,
    ];
  }
}

async function freshEngine(
  name: string,
  provider: KeywordEmbeddingProvider,
  opts: { threshold?: number } = {},
): Promise<ExecutionEngine> {
  const dir = path.join(ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const engine = new ExecutionEngine({
    dbPath: path.join(dir, "forge.db"),
    workDir: path.join(dir, "workspace"),
    mockExecutors: true,
    ollamaSwapDelayMs: 1,
    semanticCacheEnabled: true,
    semanticEmbeddingProvider: provider,
    semanticCacheThreshold: opts.threshold ?? 0.8,
    semanticEmbeddingKeepalive: false,
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

  await test("semantic cache hits after exact cache misses", async () => {
    const provider = new KeywordEmbeddingProvider();
    const engine = await freshEngine("semantic-hit", provider);

    const firstPacket = packet({ intent: "explain why local routing protects privacy", node_type: "docs" });
    const secondPacket = packet({ intent: "explain why private local router choices matter", node_type: "docs" });

    const g1 = new TaskGraph("g1", "p", [{ id: "a", packet: firstPacket }]);
    const [first] = await engine.run(g1, "sequential");
    assert.equal(first.cacheHit, false);

    const g2 = new TaskGraph("g2", "p", [{ id: "b", packet: secondPacket }]);
    const [second] = await engine.run(g2, "sequential");
    assert.equal(second.cacheHit, true);
    assert.equal(second.cacheHitKind, "semantic");
    assert.equal(second.cost, 0);
    assert.equal(g2.get("b").result?.output, g1.get("a").result?.output);
    engine.close();
  });

  await test("semantic cache degradation falls back to normal execution", async () => {
    const provider = new KeywordEmbeddingProvider();
    const engine = await freshEngine("degrade", provider);

    const firstPacket = packet({ intent: "explain why local routing protects privacy", node_type: "docs" });
    const g1 = new TaskGraph("g1", "p", [{ id: "a", packet: firstPacket }]);
    await engine.run(g1, "sequential");

    provider.fail = true;
    const secondPacket = packet({ intent: "explain why private local router choices matter", node_type: "docs" });
    const g2 = new TaskGraph("g2", "p", [{ id: "b", packet: secondPacket }]);
    const [second] = await engine.run(g2, "sequential");
    assert.equal(second.cacheHit, false);
    assert.equal(g2.get("b").status, "success");
    assert.match(engine.semanticPatternCache?.lastDegradedReason ?? "", /no vector/);
    engine.close();
  });

  await test("semantic cache refuses file-writing packets", async () => {
    const provider = new KeywordEmbeddingProvider();
    const cache = new SemanticPatternCache({ provider, similarityThreshold: 0.7 });
    const writePacket = packet({
      intent: "write a component file",
      node_type: "ui",
      context: { targetFile: "src/component.ts" },
      filePaths: ["src/component.ts"],
    });
    assert.equal(cache.canUse(writePacket), false);
    await cache.set(writePacket, "unsafe cached patch", "ollama", 1, 1, { edits: [{ path: "src/component.ts", op: "write", content: "x" }] });
    const lookup = await cache.get(writePacket);
    assert.equal(lookup.hit, false);
  });

  await test("semantic cache TTL prevents stale hits", async () => {
    const provider = new KeywordEmbeddingProvider();
    let now = 0;
    process.env.SPECTRA_CACHE_TTL_REASONING = "1";
    const cache = new SemanticPatternCache({ provider, similarityThreshold: 0.7, now: () => now });
    const first = packet({ intent: "explain why local routing protects privacy", node_type: "docs" });
    await cache.set(first, "cached", "ollama", 1, 1);
    now = 2_000;
    const second = packet({ intent: "explain why private local router choices matter", node_type: "docs" });
    const lookup = await cache.get(second);
    assert.equal(lookup.hit, false);
    delete process.env.SPECTRA_CACHE_TTL_REASONING;
  });

  if (process.exitCode) return;
  console.log(`${passed} tier3a semantic cache test(s) passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
