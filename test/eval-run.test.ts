import assert from "node:assert/strict";
import { parseEvalRunCliOptions } from "../tools/eval-run.js";

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

await test("eval-run parses judge model and max-token CLI overrides", () => {
  assert.deepEqual(
    parseEvalRunCliOptions([
      "--provider=openai",
      "--cost-ceiling-usd=1.25",
      "--judge-model=gpt-test-judge",
      "--max-judge-output-tokens=321",
    ], {}),
    {
      provider: "openai",
      costCeilingUsd: 1.25,
      judgeModel: "gpt-test-judge",
      maxJudgeOutputTokens: 321,
    },
  );
});

await test("eval-run uses judge model and max-token env fallbacks", () => {
  assert.deepEqual(
    parseEvalRunCliOptions([], {
      PRISM_EVAL_JUDGE_PROVIDER: "anthropic",
      PRISM_EVAL_COST_CEILING_USD: "0.75",
      PRISM_EVAL_JUDGE_MODEL: "claude-test-judge",
      PRISM_EVAL_MAX_JUDGE_OUTPUT_TOKENS: "654",
    }),
    {
      provider: "anthropic",
      costCeilingUsd: 0.75,
      judgeModel: "claude-test-judge",
      maxJudgeOutputTokens: 654,
    },
  );
});

await test("eval-run rejects invalid max judge output tokens", () => {
  assert.throws(
    () => parseEvalRunCliOptions(["--max-judge-output-tokens=0"], {}),
    /max judge output tokens must be a positive integer/,
  );
});
