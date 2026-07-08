#!/usr/bin/env -S tsx

import { runEvalSuite } from "../src/eval/evalHarness.js";
import type { CloudTeacherProvider } from "../src/eval/cloudTeacherProviders.js";

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

const provider = (argValue("--provider") ?? process.env.PRISM_EVAL_JUDGE_PROVIDER ?? "anthropic") as CloudTeacherProvider;
const costCeilingUsd = Number(argValue("--cost-ceiling-usd") ?? process.env.PRISM_EVAL_COST_CEILING_USD ?? "2");

if (provider !== "anthropic" && provider !== "openai") {
  console.error("provider must be anthropic or openai");
  process.exit(1);
}

if (!Number.isFinite(costCeilingUsd) || costCeilingUsd <= 0) {
  console.error("cost ceiling must be a positive number");
  process.exit(1);
}

runEvalSuite({ provider, costCeilingUsd })
  .then(({ report, reportPath }) => {
    console.log(`[eval] wrote ${reportPath}`);
    console.log(`[eval] passed=${report.summary.passed} failed=${report.summary.failed} average=${report.summary.averageScore}`);
    if (report.suggestedArtifactChanges.length > 0) {
      console.log(`[eval] review-first suggestions=${report.suggestedArtifactChanges.length} (embedded in report; none applied)`);
    }
  })
  .catch((error) => {
    console.error(`[eval] failed: ${(error as Error).message}`);
    process.exit(1);
  });
