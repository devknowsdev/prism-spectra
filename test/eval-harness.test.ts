import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVAL_REPORT_SCHEMA_VERSION,
  assertT0PayloadBoundary,
  loadEvalSuite,
  mockAiRequestResult,
  runEvalSuite,
  type EvalFixture,
} from "../src/eval/evalHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const ROOT = path.join(REPO_ROOT, ".test-tmp", "eval-harness");

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

function copyEvalRoot(name: string): string {
  const root = path.join(ROOT, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, "eval"), path.join(root, "eval"), { recursive: true });
  return root;
}

function listFiles(root: string): string[] {
  const output: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        output.push(path.relative(root, full).replaceAll("\\", "/"));
      }
    }
  }
  walk(root);
  return output.sort();
}

await test("eval fixtures, rubrics, and baselines load and cross-reference", async () => {
  const suite = await loadEvalSuite(REPO_ROOT);
  assert.equal(suite.fixtures.length, 7);
  assert.ok(suite.rubrics.has("focus-planning-read-only"));
  assert.ok(suite.rubrics.has("focus-bridge-read-only"));
  assert.ok(suite.rubrics.has("epk-career-read-only"));
  assert.equal(suite.baselines.size, 7);
  assert.deepEqual(
    suite.fixtures.map((fixture) => fixture.aiRequest.intent),
    [
      "focus-chat-message",
      "focus-ai-call",
      "focus-ai-bridge-smoke-test",
      "career.refine_epk_copy",
      "career.check_epk_copy_consistency",
      "career.refine_epk_promo_copy",
      "career.suggest_epk_route_tags",
    ],
  );
});

await test("eval runner fails closed without judge key before local or cloud dispatch", async () => {
  const root = copyEvalRoot("no-key");
  let localCalls = 0;
  let fetchCalls = 0;
  await assert.rejects(
    () => runEvalSuite({
      rootDir: root,
      provider: "openai",
      env: {},
      localAnswerer: async () => {
        localCalls += 1;
        return mockAiRequestResult("should not be called");
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse({});
      },
      logger: { info() {}, warn() {} },
    }),
    /OPENAI_API_KEY is required/,
  );
  assert.equal(localCalls, 0);
  assert.equal(fetchCalls, 0);
});

await test("eval runner aborts at cost ceiling before cloud fetch", async () => {
  const root = copyEvalRoot("cost-ceiling");
  let fetchCalls = 0;
  await assert.rejects(
    () => runEvalSuite({
      rootDir: root,
      provider: "anthropic",
      env: { ANTHROPIC_API_KEY: "test-key" },
      costCeilingUsd: 0.000001,
      localAnswerer: async () => mockAiRequestResult("x".repeat(12000)),
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse({});
      },
      logger: { info() {}, warn() {} },
    }),
    /exceeds per-run ceiling/,
  );
  assert.equal(fetchCalls, 0);
});

await test("T0 boundary rejects user-context path fragments in cloud-bound payloads", () => {
  const fixture: EvalFixture = {
    id: "bad-boundary",
    title: "Bad boundary",
    rubricId: "r",
    baselineId: "b",
    tags: [],
    appShapeMetadata: {},
    aiRequest: {},
  };
  assert.throws(
    () => assertT0PayloadBoundary(fixture, { prompt: "Read prism-beam/user-context/context/catalogue/catalogue.json" }),
    /violates T0 boundary/,
  );
});

await test("eval runner writes a diff-reviewable report artifact with judge scores", async () => {
  const root = copyEvalRoot("report-shape");
  const result = await runEvalSuite({
    rootDir: root,
    provider: "openai",
    env: { OPENAI_API_KEY: "test-key" },
    reportName: "eval-report-test.json",
    localAnswerer: async (_fixture, request) => mockAiRequestResult(`Synthetic local answer for ${request.intent}.`),
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ score: 4.5, findings: ["Meets starter rubric."] }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
    logger: { info() {}, warn() {} },
    now: () => new Date("2026-07-08T12:00:00.000Z"),
  });

  assert.equal(result.report.schemaVersion, EVAL_REPORT_SCHEMA_VERSION);
  assert.equal(result.report.boundary.tier, "T0");
  assert.equal(result.report.suite.fixtureCount, 7);
  assert.equal(result.report.cases.length, 7);
  assert.equal(result.report.summary.failed, 0);
  assert.equal(result.report.summary.judgeErrors, 0);
  assert.equal(result.report.summary.suspectZeroVariance, true);
  assert.equal(result.report.judge.provider, "openai");
  assert.equal(result.report.judge.model, "gpt-5.4-mini");
  assert.deepEqual(result.report.cases[0].local.determinism, {
    temperature: {
      value: 0,
      source: "harness-default",
      supported: false,
      reason: "The ai-request gateway path does not currently consume temperature; recorded for eval comparability.",
    },
    seed: {
      value: 1729,
      source: "harness-default",
      supported: false,
      reason: "The ai-request gateway path does not currently consume seed; recorded for eval comparability.",
    },
  });
  assert.equal(path.relative(root, result.reportPath).replaceAll("\\", "/"), "eval/reports/eval-report-test.json");
  const written = JSON.parse(fs.readFileSync(result.reportPath, "utf8"));
  assert.equal(written.schemaVersion, EVAL_REPORT_SCHEMA_VERSION);
});

await test("eval runner records judge errors separately from local failures", async () => {
  const root = copyEvalRoot("judge-errors");
  const warnings: string[] = [];
  let calls = 0;
  const result = await runEvalSuite({
    rootDir: root,
    provider: "openai",
    env: { OPENAI_API_KEY: "test-key" },
    reportName: "eval-report-judge-errors.json",
    localAnswerer: async () => mockAiRequestResult("Local answer should not be scored when the judge fails."),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        choices: [{ message: { content: calls % 2 === 0 ? "not-json" : "" } }],
        usage: { prompt_tokens: 100, completion_tokens: 0 },
      });
    },
    logger: { info() {}, warn(message: string) { warnings.push(message); } },
  });

  assert.equal(result.report.summary.passed, 0);
  assert.equal(result.report.summary.failed, 0);
  assert.equal(result.report.summary.judgeErrors, 7);
  assert.equal(result.report.summary.averageScore, 0);
  assert.equal(result.report.summary.suspectZeroVariance, false);
  assert.equal(result.report.suggestedArtifactChanges.length, 0);
  assert.equal(result.report.cases.filter((item) => item.judge.status === "empty").length, 4);
  assert.equal(result.report.cases.filter((item) => item.judge.status === "unparseable").length, 3);
  assert.equal(warnings.filter((line) => line.startsWith("[eval] judge-error fixture=")).length, 7);
});

await test("eval runner plumbs judge model and max output token overrides", async () => {
  const root = copyEvalRoot("judge-options");
  const bodies: unknown[] = [];
  const result = await runEvalSuite({
    rootDir: root,
    provider: "openai",
    env: { OPENAI_API_KEY: "test-key" },
    judgeModel: "gpt-test-judge",
    maxJudgeOutputTokens: 123,
    reportName: "eval-report-judge-options.json",
    localAnswerer: async () => mockAiRequestResult("Synthetic answer."),
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ score: 4.2, findings: [] }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });
    },
    logger: { info() {}, warn() {} },
  });

  assert.equal(result.report.judge.model, "gpt-test-judge");
  assert.equal((bodies[0] as { model?: unknown }).model, "gpt-test-judge");
  assert.equal((bodies[0] as { max_completion_tokens?: unknown }).max_completion_tokens, 123);
});

await test("eval suggestions are review-first and no proposal files are written", async () => {
  const root = copyEvalRoot("review-first");
  const before = new Set(listFiles(root));
  const result = await runEvalSuite({
    rootDir: root,
    provider: "openai",
    env: { OPENAI_API_KEY: "test-key" },
    reportName: "eval-report-low-score.json",
    localAnswerer: async () => mockAiRequestResult("Too vague."),
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ score: 1.5, findings: ["Answer is too vague."] }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
    logger: { info() {}, warn() {} },
  });
  const after = listFiles(root);
  const added = after.filter((file) => !before.has(file));

  assert.deepEqual(added, ["eval/reports/eval-report-low-score.json"]);
  assert.equal(fs.existsSync(path.join(root, "eval", "proposals")), false);
  assert.ok(result.report.suggestedArtifactChanges.length > 0);
  assert.ok(result.report.suggestedArtifactChanges.every((suggestion) => suggestion.applied === false));
  assert.ok(result.report.suggestedArtifactChanges.every((suggestion) => suggestion.diff.includes("+++ b/eval/proposals/")));
});
