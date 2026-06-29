import assert from "node:assert/strict";
import {
  RouteDecisionCache,
  paidProviderPreference,
  routeSignature,
  type RouteDecisionHint,
} from "../src/index.js";
import type { EmbeddingProvider } from "../src/embeddings/ollamaEmbeddings.js";
import type { TaskPacket } from "../src/types.js";

class TinyEmbeddingProvider implements EmbeddingProvider {
  async embed(input: string): Promise<number[] | null> {
    return [input.length, input.includes("routing") ? 1 : 0];
  }
}

function packet(intent: string): TaskPacket {
  return { intent, node_type: "docs", context: {}, constraints: [], dependencies: [] };
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
  await test("route cache primitives are exported from public index", async () => {
    const cache = new RouteDecisionCache({
      provider: new TinyEmbeddingProvider(),
      similarityThreshold: 0,
    });

    await cache.set(packet("explain routing"), "reasoner", "gpt");
    const hit: RouteDecisionHint = await cache.get(packet("explain routing again"));

    assert.equal(hit.hit, true);
    assert.equal(typeof routeSignature(packet("explain routing")), "string");
    assert.equal(paidProviderPreference("gpt"), "gpt");
    assert.equal(paidProviderPreference("ollama"), undefined);
  });

  if (!process.exitCode) console.log(`${passed} tier3c routing hardening test(s) passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
