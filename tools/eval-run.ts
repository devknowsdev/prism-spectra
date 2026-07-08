#!/usr/bin/env -S tsx

import { fileURLToPath } from "node:url";
import path from "node:path";
import { runEvalSuite } from "../src/eval/evalHarness.js";
import type { CloudTeacherProvider } from "../src/eval/cloudTeacherProviders.js";

export interface EvalRunCliOptions {
  provider: CloudTeacherProvider;
  costCeilingUsd: number;
  judgeModel?: string;
  maxJudgeOutputTokens?: number;
}

function argValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

export function parseEvalRunCliOptions(args = process.argv.slice(2), env = process.env): EvalRunCliOptions {
  const provider = (argValue(args, "--provider") ?? env.PRISM_EVAL_JUDGE_PROVIDER ?? "anthropic") as CloudTeacherProvider;
  const costCeilingUsd = Number(argValue(args, "--cost-ceiling-usd") ?? env.PRISM_EVAL_COST_CEILING_USD ?? "2");
  const judgeModel = argValue(args, "--judge-model") ?? env.PRISM_EVAL_JUDGE_MODEL;
  const maxJudgeOutputTokensValue = argValue(args, "--max-judge-output-tokens") ?? env.PRISM_EVAL_MAX_JUDGE_OUTPUT_TOKENS;
  const maxJudgeOutputTokens = maxJudgeOutputTokensValue == null ? undefined : Number(maxJudgeOutputTokensValue);

  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error("provider must be anthropic or openai");
  }

  if (!Number.isFinite(costCeilingUsd) || costCeilingUsd <= 0) {
    throw new Error("cost ceiling must be a positive number");
  }

  if (maxJudgeOutputTokens != null && (!Number.isInteger(maxJudgeOutputTokens) || maxJudgeOutputTokens <= 0)) {
    throw new Error("max judge output tokens must be a positive integer");
  }

  return {
    provider,
    costCeilingUsd,
    ...(judgeModel?.trim() ? { judgeModel: judgeModel.trim() } : {}),
    ...(maxJudgeOutputTokens == null ? {} : { maxJudgeOutputTokens }),
  };
}

async function main(): Promise<void> {
  const options = parseEvalRunCliOptions();
  const { report, reportPath } = await runEvalSuite(options);
    console.log(`[eval] wrote ${reportPath}`);
    console.log(`[eval] passed=${report.summary.passed} failed=${report.summary.failed} judgeErrors=${report.summary.judgeErrors} average=${report.summary.averageScore}`);
    if (report.suggestedArtifactChanges.length > 0) {
      console.log(`[eval] review-first suggestions=${report.suggestedArtifactChanges.length} (embedded in report; none applied)`);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`[eval] failed: ${(error as Error).message}`);
    process.exit(1);
  });
}
