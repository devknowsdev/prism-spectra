import assert from "node:assert/strict";
import {
  checkCloudTeacherHealth,
  dispatchCloudTeacherChatCompletion,
} from "../src/eval/cloudTeacherProviders.js";
import { buildExecutorRegistry } from "../src/executors/index.js";
import { EXECUTOR_NAMES } from "../src/types.js";

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

await test("cloud-teacher no key fails closed before fetch", async () => {
  let called = false;
  await assert.rejects(
    () => dispatchCloudTeacherChatCompletion({
      provider: "openai",
      role: "teacher",
      messages: [{ role: "user", content: "hello" }],
    }, {
      env: {},
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
      logger: { info() {} },
    }),
    /OPENAI_API_KEY/,
  );
  assert.equal(called, false);
});

await test("cloud-teacher cost ceiling aborts before fetch and logs estimate", async () => {
  let called = false;
  const logs: string[] = [];
  await assert.rejects(
    () => dispatchCloudTeacherChatCompletion({
      provider: "anthropic",
      role: "judge",
      messages: [{ role: "user", content: "x".repeat(8000) }],
      maxOutputTokens: 2000,
      costCeilingUsd: 0.0001,
    }, {
      env: { ANTHROPIC_API_KEY: "test-key" },
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
      logger: { info(message: string) { logs.push(message); } },
    }),
    /exceeds per-run ceiling/,
  );
  assert.equal(called, false);
  assert.ok(logs.some((line) => line.includes("estimated tokens")));
});

await test("openai cloud-teacher adapter uses explicit chat-completion endpoint only", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await dispatchCloudTeacherChatCompletion({
    provider: "openai",
    role: "teacher",
    messages: [{ role: "system", content: "Be terse." }, { role: "user", content: "Grade this." }],
    maxOutputTokens: 16,
  }, {
    env: { OPENAI_API_KEY: "openai-test-key" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 7, completion_tokens: 2 },
      });
    },
    logger: { info() {} },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer openai-test-key");
  assert.equal(result.content, "ok");
  assert.equal(result.provider, "openai");
});

await test("anthropic cloud-teacher adapter uses messages endpoint only", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await dispatchCloudTeacherChatCompletion({
    provider: "anthropic",
    role: "judge",
    messages: [{ role: "system", content: "Judge." }, { role: "user", content: "Score." }],
    maxOutputTokens: 16,
  }, {
    env: { ANTHROPIC_API_KEY: "anthropic-test-key" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        content: [{ type: "text", text: "pass" }],
        usage: { input_tokens: 8, output_tokens: 3 },
      });
    },
    logger: { info() {} },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal((calls[0].init.headers as Record<string, string>)["x-api-key"], "anthropic-test-key");
  assert.equal(result.content, "pass");
  assert.equal(result.provider, "anthropic");
});

await test("cloud-teacher health check fails closed without key and auth-pings with key", async () => {
  const missing = await checkCloudTeacherHealth("openai", { env: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.keyPresent, false);
  assert.equal(missing.authOk, false);

  let urlSeen = "";
  const ok = await checkCloudTeacherHealth("openai", {
    env: { OPENAI_API_KEY: "health-key" },
    fetchImpl: async (url) => {
      urlSeen = String(url);
      return jsonResponse({ data: [{ id: "gpt-5-mini" }] });
    },
  });
  assert.equal(urlSeen, "https://api.openai.com/v1/models");
  assert.equal(ok.ok, true);
  assert.equal(ok.authOk, true);
  assert.equal(ok.status, "ok");
  assert.equal(ok.model, "gpt-5-mini");
});

await test("cloud-teacher health check warns when configured model is absent", async () => {
  const missingModel = await checkCloudTeacherHealth("anthropic", {
    env: { ANTHROPIC_API_KEY: "health-key" },
    fetchImpl: async () => jsonResponse({ data: [{ id: "claude-opus-4-8" }] }),
  });
  assert.equal(missingModel.ok, false);
  assert.equal(missingModel.keyPresent, true);
  assert.equal(missingModel.authOk, true);
  assert.equal(missingModel.status, "model-not-found");
  assert.equal(missingModel.model, "claude-sonnet-5");
});

await test("cloud-teacher providers are not normal routing executors", () => {
  assert.deepEqual([...EXECUTOR_NAMES], ["ollama", "free_tier", "gpt", "claude", "terminal"]);
  const registry = buildExecutorRegistry({ mock: true });
  assert.equal(Object.prototype.hasOwnProperty.call(registry, "anthropic"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(registry, "openai"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(registry, "cloud-teacher.anthropic"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(registry, "cloud-teacher.openai"), false);
});
