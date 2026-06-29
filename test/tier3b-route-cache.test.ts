import assert from "node:assert/strict";
import { RouteDecisionCache } from "../src/routing/routeDecisionCache.js";
import { Router } from "../src/routing/router.js";
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

function router(): Router {
  const ledger = { check: () => ({ allowed: true }) };
  const learningLoop = { rank: (providers: string[]) => providers.map((provider) => ({ provider, score: 1 })) };
  return new Router(ledger as any, learningLoop as any);
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
  await test("route cache returns similar role and paid-provider hint", async () => {
    const cache = new RouteDecisionCache({ provider: new KeywordEmbeddingProvider(), similarityThreshold: 0.7 });
    await cache.set(packet("explain why local routing protects privacy"), "reasoner", "gpt");
    const hit = await cache.get(packet("explain why private local router choices matter"));
    assert.equal(hit.hit, true);
    assert.equal(hit.role, "reasoner");
    assert.equal(hit.paidProviderPreference, "gpt");
  });

  await test("route cache degradation falls back to no hint", async () => {
    const provider = new KeywordEmbeddingProvider();
    const cache = new RouteDecisionCache({ provider, similarityThreshold: 0.7 });
    await cache.set(packet("explain why local routing protects privacy"), "reasoner", "gpt");
    provider.fail = true;
    const hit = await cache.get(packet("explain why private local router choices matter"));
    assert.equal(hit.hit, false);
    assert.match(hit.reason ?? "", /no vector/);
  });

  await test("router uses cached paid-provider hint only after local/free tiers", () => {
    const r = router();
    const decision = r.route(packet("build a TypeScript API helper", "backend"), ["ollama", "free_tier"], {
      hit: true,
      role: "coder",
      taskClass: "code",
      paidProviderPreference: "gpt",
      similarity: 0.99,
    });
    assert.equal(decision.executor, "gpt");
    assert.equal(decision.routeCacheHit, true);
  });

  await test("router never lets route cache bypass local-first order", () => {
    const r = router();
    const decision = r.route(packet("build a TypeScript API helper", "backend"), [], {
      hit: true,
      role: "coder",
      taskClass: "code",
      paidProviderPreference: "gpt",
      similarity: 0.99,
    });
    assert.equal(decision.executor, "ollama");
  });

  await test("router never lets route cache bypass provider availability", () => {
    const r = router();
    r.setProviderAvailability("gpt", { available: false, reason: "test unavailable" });
    const decision = r.route(packet("build a TypeScript API helper", "backend"), ["ollama", "free_tier"], {
      hit: true,
      role: "coder",
      taskClass: "code",
      paidProviderPreference: "gpt",
      similarity: 0.99,
    });
    assert.equal(decision.executor, "claude");
    assert.deepEqual(decision.chainTried[0], { provider: "gpt", allowed: false, reason: "test unavailable" });
  });

  if (!process.exitCode) console.log(`${passed} tier3b route cache test(s) passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
