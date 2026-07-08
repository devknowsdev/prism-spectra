import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAiRequestBody, type AiRequestInput, type AiRequestResult } from "../engine/aiRequest.js";
import { ExecutionEngine } from "../engine/executionEngine.js";
import {
  DEFAULT_CLOUD_TEACHER_COST_CEILING_USD,
  dispatchCloudTeacherChatCompletion,
  estimateCloudTeacherCost,
  requiredEnvVarForCloudTeacherProvider,
  type CloudTeacherChatOptions,
  type CloudTeacherChatResult,
  type CloudTeacherMessage,
  type CloudTeacherProvider,
} from "./cloudTeacherProviders.js";

export const EVAL_FIXTURE_SCHEMA_VERSION = "spectra.eval.fixtures.v1";
export const EVAL_RUBRIC_SCHEMA_VERSION = "spectra.eval.rubrics.v1";
export const EVAL_BASELINE_SCHEMA_VERSION = "spectra.eval.baselines.v1";
export const EVAL_REPORT_SCHEMA_VERSION = "spectra.eval.report.v1";
export const EVAL_T0_BOUNDARY = "T0-fixture-synthetic-app-shape-only";

export interface EvalFixtureFile {
  schemaVersion: typeof EVAL_FIXTURE_SCHEMA_VERSION;
  boundaryTier: "T0";
  fixtures: EvalFixture[];
}

export interface EvalFixture {
  id: string;
  title: string;
  rubricId: string;
  baselineId: string;
  tags: string[];
  appShapeMetadata: Record<string, unknown>;
  aiRequest: Record<string, unknown>;
}

export interface EvalRubricFile {
  schemaVersion: typeof EVAL_RUBRIC_SCHEMA_VERSION;
  rubrics: EvalRubric[];
}

export interface EvalRubric {
  id: string;
  title: string;
  scale: { min: number; max: number };
  criteria: Array<{ id: string; description: string; weight: number }>;
}

export interface EvalBaselineFile {
  schemaVersion: typeof EVAL_BASELINE_SCHEMA_VERSION;
  baselines: EvalBaseline[];
}

export interface EvalBaseline {
  id: string;
  fixtureId: string;
  minimumScore: number;
  notes: string;
}

export interface EvalSuite {
  root: string;
  fixtures: EvalFixture[];
  rubrics: Map<string, EvalRubric>;
  baselines: Map<string, EvalBaseline>;
}

export interface EvalRunOptions {
  rootDir?: string;
  provider?: CloudTeacherProvider;
  judgeModel?: string;
  costCeilingUsd?: number;
  maxJudgeOutputTokens?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "info" | "warn">;
  outputDirectory?: string;
  reportName?: string;
  localAnswerer?: EvalLocalAnswerer;
  now?: () => Date;
}

export interface EvalLocalDeterminismControl {
  value: number;
  source: "fixture" | "harness-default";
  supported: boolean;
  reason?: string;
}

export interface EvalLocalDeterminism {
  temperature: EvalLocalDeterminismControl;
  seed: EvalLocalDeterminismControl;
}

export type EvalLocalAnswerRequest = AiRequestInput & {
  temperature?: number;
  seed?: number;
};

export type EvalLocalAnswerer = (
  fixture: EvalFixture,
  request: EvalLocalAnswerRequest,
  determinism: EvalLocalDeterminism,
) => Promise<AiRequestResult>;

export interface EvalReport {
  schemaVersion: typeof EVAL_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  suite: {
    fixtureCount: number;
    fixtureIds: string[];
  };
  boundary: {
    tier: "T0";
    dataBoundary: typeof EVAL_T0_BOUNDARY;
    forbiddenPathFragments: string[];
  };
  judge: {
    provider: CloudTeacherProvider;
    model: string | null;
    role: "judge";
  };
  cost: {
    estimatedUsd: number;
    actualUsd: number;
    ceilingUsd: number;
  };
  summary: {
    passed: number;
    failed: number;
    judgeErrors: number;
    averageScore: number;
    suspectZeroVariance: boolean;
  };
  cases: EvalReportCase[];
  suggestedArtifactChanges: SuggestedArtifactChange[];
}

export interface EvalReportCase {
  fixtureId: string;
  title: string;
  sourceApp: string;
  intent: string;
  local: {
    ok: boolean;
    provider: string | null;
    model: string | null;
    response: string;
    provenance: unknown;
    usage: unknown;
    determinism: EvalLocalDeterminism;
  };
  judge: {
    status: JudgeResultStatus;
    score: number;
    findings: string[];
    raw: string;
    provider: CloudTeacherProvider;
    model: string;
    costUsd: number;
    estimatedCostUsd: number;
  };
  baseline: {
    id: string;
    minimumScore: number;
    passed: boolean;
    delta: number;
  };
}

export interface SuggestedArtifactChange {
  id: string;
  kind: "prompt-diff" | "route-hint-diff";
  targetPath: string;
  reason: string;
  diff: string;
  applied: false;
}

export type JudgeResultStatus = "ok" | "empty" | "unparseable";

const FORBIDDEN_T0_PATH_FRAGMENTS = [
  "prism-beam/user-context",
  "user-context/",
  "user-context\\",
];
const DEFAULT_LOCAL_TEMPERATURE = 0;
const DEFAULT_LOCAL_SEED = 1729;

export async function loadEvalSuite(rootDir = process.cwd()): Promise<EvalSuite> {
  const evalRoot = path.join(rootDir, "eval");
  const [fixtures, rubrics, baselines] = await Promise.all([
    loadFixtureFiles(path.join(evalRoot, "fixtures")),
    loadRubricFiles(path.join(evalRoot, "rubrics")),
    loadBaselineFiles(path.join(evalRoot, "baselines")),
  ]);

  const rubricMap = new Map(rubrics.map((rubric) => [rubric.id, rubric]));
  const baselineMap = new Map(baselines.map((baseline) => [baseline.id, baseline]));

  for (const fixture of fixtures) {
    normalizeFixtureRequest(fixture);
    if (!rubricMap.has(fixture.rubricId)) {
      throw new Error(`fixture ${fixture.id} references missing rubric ${fixture.rubricId}`);
    }
    const baseline = baselineMap.get(fixture.baselineId);
    if (!baseline) {
      throw new Error(`fixture ${fixture.id} references missing baseline ${fixture.baselineId}`);
    }
    if (baseline.fixtureId !== fixture.id) {
      throw new Error(`baseline ${baseline.id} points at ${baseline.fixtureId}, expected ${fixture.id}`);
    }
    assertT0PayloadBoundary(fixture, {
      appShapeMetadata: fixture.appShapeMetadata,
      aiRequest: fixture.aiRequest,
    });
  }

  return { root: evalRoot, fixtures, rubrics: rubricMap, baselines: baselineMap };
}

export async function runEvalSuite(options: EvalRunOptions = {}): Promise<{ report: EvalReport; reportPath: string }> {
  const rootDir = options.rootDir ?? process.cwd();
  const suite = await loadEvalSuite(rootDir);
  const provider = options.provider ?? "anthropic";
  const env = options.env ?? process.env;
  const requiredEnvVar = requiredEnvVarForCloudTeacherProvider(provider);
  if (!env[requiredEnvVar]?.trim()) {
    throw new Error(`${requiredEnvVar} is required for explicit ${provider} eval judge dispatch`);
  }

  const maxJudgeOutputTokens = options.maxJudgeOutputTokens ?? 2000;
  const ceilingUsd = options.costCeilingUsd ?? DEFAULT_CLOUD_TEACHER_COST_CEILING_USD;
  const logger = options.logger ?? console;
  const localAnswerer = options.localAnswerer ?? createGatewayLocalAnswerer(rootDir);
  const localAnswers: Array<{
    fixture: EvalFixture;
    request: EvalLocalAnswerRequest;
    determinism: EvalLocalDeterminism;
    result: AiRequestResult;
  }> = [];

  for (const fixture of suite.fixtures) {
    const request = withEvalLocalDeterminism(normalizeFixtureRequest(fixture), fixture);
    const determinism = determinismForFixture(fixture);
    const result = await localAnswerer(fixture, request, determinism);
    localAnswers.push({ fixture, request, determinism, result });
  }

  const judgeRequests = localAnswers.map(({ fixture, request, determinism, result }) => {
    const rubric = requiredMapValue(suite.rubrics, fixture.rubricId, "rubric");
    return {
      fixture,
      request,
      determinism,
      result,
      rubric,
      messages: buildJudgeMessages(fixture, request, result, rubric),
    };
  });

  for (const item of judgeRequests) {
    assertT0PayloadBoundary(item.fixture, item.messages);
  }

  const estimatedUsd = judgeRequests.reduce((sum, item) => {
    return sum + estimateCloudTeacherCost(item.messages, maxJudgeOutputTokens, provider).costUsd;
  }, 0);

  logger.info(
    `[eval] provider=${provider} fixtures=${judgeRequests.length} estimated cloud judge cost=$${estimatedUsd.toFixed(4)} ceiling=$${ceilingUsd.toFixed(2)}`,
  );
  if (estimatedUsd > ceilingUsd) {
    throw new Error(`eval judge cost estimate $${estimatedUsd.toFixed(4)} exceeds per-run ceiling $${ceilingUsd.toFixed(2)}`);
  }

  const cases: EvalReportCase[] = [];
  const suggestions: SuggestedArtifactChange[] = [];
  let actualCostUsd = 0;
  let judgeModel: string | null = null;

  for (const item of judgeRequests) {
    const judgeResult = await dispatchCloudTeacherChatCompletion({
      provider,
      role: "judge",
      model: options.judgeModel,
      messages: item.messages,
      maxOutputTokens: maxJudgeOutputTokens,
      costCeilingUsd: Math.max(0.01, ceilingUsd - actualCostUsd),
    }, {
      env,
      fetchImpl: options.fetchImpl,
      logger,
    } satisfies CloudTeacherChatOptions);
    actualCostUsd += judgeResult.costUsd;
    judgeModel = judgeResult.model;
    const parsed = parseJudgeResult(judgeResult.content);
    const baseline = requiredMapValue(suite.baselines, item.fixture.baselineId, "baseline");
    const passed = parsed.status === "ok" && parsed.score >= baseline.minimumScore;
    if (parsed.status !== "ok") {
      logger.warn(`[eval] judge-error fixture=${item.fixture.id} status=${parsed.status}`);
    }
    const reportCase = buildReportCase(item.fixture, item.request, item.determinism, item.result, judgeResult, parsed, baseline, passed);
    cases.push(reportCase);
    if (parsed.status === "ok" && !passed) {
      suggestions.push(...buildReviewSuggestions(reportCase, parsed.findings));
    }
  }

  const judgedOkCases = cases.filter((item) => item.judge.status === "ok");
  const averageScore = judgedOkCases.length === 0 ? 0 : round2(judgedOkCases.reduce((sum, item) => sum + item.judge.score, 0) / judgedOkCases.length);
  const suspectZeroVariance = judgedOkCases.length >= 3 && judgedOkCases.every((item) => item.judge.score === judgedOkCases[0].judge.score);
  if (suspectZeroVariance) {
    logger.warn("[eval] WARNING: zero score variance - judge may be rubber-stamping");
  }
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const report: EvalReport = {
    schemaVersion: EVAL_REPORT_SCHEMA_VERSION,
    generatedAt,
    suite: {
      fixtureCount: suite.fixtures.length,
      fixtureIds: suite.fixtures.map((fixture) => fixture.id),
    },
    boundary: {
      tier: "T0",
      dataBoundary: EVAL_T0_BOUNDARY,
      forbiddenPathFragments: FORBIDDEN_T0_PATH_FRAGMENTS,
    },
    judge: {
      provider,
      model: judgeModel,
      role: "judge",
    },
    cost: {
      estimatedUsd: round6(estimatedUsd),
      actualUsd: round6(actualCostUsd),
      ceilingUsd,
    },
    summary: {
      passed: judgedOkCases.filter((item) => item.baseline.passed).length,
      failed: judgedOkCases.filter((item) => !item.baseline.passed).length,
      judgeErrors: cases.filter((item) => item.judge.status !== "ok").length,
      averageScore,
      suspectZeroVariance,
    },
    cases,
    suggestedArtifactChanges: suggestions,
  };

  const outputDirectory = options.outputDirectory ?? path.join(rootDir, "eval", "reports");
  await fs.mkdir(outputDirectory, { recursive: true });
  const reportName = options.reportName ?? `eval-report-${safeTimestamp(generatedAt)}.json`;
  const reportPath = path.join(outputDirectory, reportName);
  assertEvalOutputPath(rootDir, reportPath);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportPath };
}

export function assertT0PayloadBoundary(fixture: EvalFixture, payload: unknown): void {
  const seen = collectStrings(payload);
  for (const value of seen) {
    const normalized = value.replaceAll("\\", "/");
    if (FORBIDDEN_T0_PATH_FRAGMENTS.some((fragment) => normalized.includes(fragment.replaceAll("\\", "/")))) {
      throw new Error(`fixture ${fixture.id} violates T0 boundary with user-context path fragment`);
    }
  }
}

function createGatewayLocalAnswerer(rootDir: string): EvalLocalAnswerer {
  return async (_fixture, request) => {
    const tmpRoot = path.join(rootDir, "eval", "reports", ".tmp");
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const engine = new ExecutionEngine({
      dbPath: path.join(tmpRoot, runId, "gateway.db"),
      workDir: path.join(tmpRoot, runId, "work"),
      mockExecutors: process.env.AI_FORGE_MOCK_EXECUTORS === "1",
      fallbackOnFailure: false,
      capabilityManifestDirectory: path.join(rootDir, "capabilities"),
    });
    await engine.init();
    try {
      return await engine.runAiRequest({ ...request, record: false });
    } finally {
      engine.close();
      await fs.rm(path.join(tmpRoot, runId), { recursive: true, force: true });
    }
  };
}

function withEvalLocalDeterminism(request: AiRequestInput, fixture: EvalFixture): EvalLocalAnswerRequest {
  const determinism = determinismForFixture(fixture);
  return {
    ...request,
    temperature: determinism.temperature.value,
    seed: determinism.seed.value,
  };
}

function determinismForFixture(fixture: EvalFixture): EvalLocalDeterminism {
  const raw = fixture.aiRequest as Record<string, unknown>;
  const fixtureTemperature = finiteNumber(raw.temperature);
  const fixtureSeed = finiteNumber(raw.seed);
  return {
    temperature: {
      value: fixtureTemperature ?? DEFAULT_LOCAL_TEMPERATURE,
      source: fixtureTemperature == null ? "harness-default" : "fixture",
      supported: false,
      reason: "The ai-request gateway path does not currently consume temperature; recorded for eval comparability.",
    },
    seed: {
      value: fixtureSeed ?? DEFAULT_LOCAL_SEED,
      source: fixtureSeed == null ? "harness-default" : "fixture",
      supported: false,
      reason: "The ai-request gateway path does not currently consume seed; recorded for eval comparability.",
    },
  };
}

async function loadFixtureFiles(directory: string): Promise<EvalFixture[]> {
  const files = await jsonFiles(directory);
  const fixtures: EvalFixture[] = [];
  for (const file of files) {
    const data = await readJson(file) as EvalFixtureFile;
    if (data.schemaVersion !== EVAL_FIXTURE_SCHEMA_VERSION) {
      throw new Error(`${file} must use schemaVersion ${EVAL_FIXTURE_SCHEMA_VERSION}`);
    }
    if (data.boundaryTier !== "T0") {
      throw new Error(`${file} must declare boundaryTier=T0`);
    }
    if (!Array.isArray(data.fixtures)) throw new Error(`${file} must contain fixtures[]`);
    for (const fixture of data.fixtures) {
      assertFixtureShape(fixture, file);
      fixtures.push(fixture);
    }
  }
  if (fixtures.length === 0) throw new Error(`no eval fixtures found in ${directory}`);
  return fixtures;
}

async function loadRubricFiles(directory: string): Promise<EvalRubric[]> {
  const files = await jsonFiles(directory);
  const rubrics: EvalRubric[] = [];
  for (const file of files) {
    const data = await readJson(file) as EvalRubricFile;
    if (data.schemaVersion !== EVAL_RUBRIC_SCHEMA_VERSION) {
      throw new Error(`${file} must use schemaVersion ${EVAL_RUBRIC_SCHEMA_VERSION}`);
    }
    if (!Array.isArray(data.rubrics)) throw new Error(`${file} must contain rubrics[]`);
    for (const rubric of data.rubrics) {
      assertRubricShape(rubric, file);
      rubrics.push(rubric);
    }
  }
  return rubrics;
}

async function loadBaselineFiles(directory: string): Promise<EvalBaseline[]> {
  const files = await jsonFiles(directory);
  const baselines: EvalBaseline[] = [];
  for (const file of files) {
    const data = await readJson(file) as EvalBaselineFile;
    if (data.schemaVersion !== EVAL_BASELINE_SCHEMA_VERSION) {
      throw new Error(`${file} must use schemaVersion ${EVAL_BASELINE_SCHEMA_VERSION}`);
    }
    if (!Array.isArray(data.baselines)) throw new Error(`${file} must contain baselines[]`);
    for (const baseline of data.baselines) {
      assertBaselineShape(baseline, file);
      baselines.push(baseline);
    }
  }
  return baselines;
}

async function jsonFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function normalizeFixtureRequest(fixture: EvalFixture): AiRequestInput {
  const validation = normalizeAiRequestBody(fixture.aiRequest);
  if (!validation.ok) {
    throw new Error(`fixture ${fixture.id} has invalid aiRequest: ${validation.error}`);
  }
  if (validation.request.riskClass !== "read-only") {
    throw new Error(`fixture ${fixture.id} must be read-only`);
  }
  return validation.request;
}

function buildJudgeMessages(
  fixture: EvalFixture,
  request: AiRequestInput,
  result: AiRequestResult,
  rubric: EvalRubric,
): CloudTeacherMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are a Prism Spectra T0 eval judge.",
        "Score only the local model answer against the supplied rubric.",
        "Use only fixture/synthetic content and app-shape metadata.",
        "Return strict JSON: {\"score\": number, \"findings\": string[]}.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        boundaryTier: "T0",
        fixture: {
          id: fixture.id,
          title: fixture.title,
          tags: fixture.tags,
          appShapeMetadata: fixture.appShapeMetadata,
        },
        aiRequest: {
          sourceApp: request.sourceApp,
          intent: request.intent,
          riskClass: request.riskClass,
          input: request.input ?? {},
          context: request.context ?? {},
          preferredMode: request.preferredMode,
          nodeType: request.nodeType,
        },
        localAnswer: {
          ok: result.ok,
          provider: result.provider,
          model: result.model,
          response: result.response,
          provenance: result.provenance,
          usage: "usage" in result ? result.usage : undefined,
          error: result.ok ? undefined : result.error,
        },
        rubric,
      }, null, 2),
    },
  ];
}

function parseJudgeResult(content: string): { status: JudgeResultStatus; score: number; findings: string[] } {
  if (content.trim() === "") {
    return { status: "empty", score: 0, findings: ["Judge returned empty output."] };
  }
  try {
    const parsed = JSON.parse(content) as { score?: unknown; findings?: unknown };
    const score = Number(parsed.score);
    const findings = Array.isArray(parsed.findings)
      ? parsed.findings.filter((item): item is string => typeof item === "string")
      : [];
    return {
      status: "ok",
      score: Number.isFinite(score) ? Math.max(0, Math.min(5, score)) : 0,
      findings,
    };
  } catch {
    return { status: "unparseable", score: 0, findings: ["Judge returned non-JSON output."] };
  }
}

function buildReportCase(
  fixture: EvalFixture,
  request: EvalLocalAnswerRequest,
  determinism: EvalLocalDeterminism,
  result: AiRequestResult,
  judgeResult: CloudTeacherChatResult,
  parsedJudge: { status: JudgeResultStatus; score: number; findings: string[] },
  baseline: EvalBaseline,
  passed: boolean,
): EvalReportCase {
  return {
    fixtureId: fixture.id,
    title: fixture.title,
    sourceApp: request.sourceApp,
    intent: request.intent,
    local: {
      ok: result.ok,
      provider: result.provider,
      model: result.model,
      response: result.response,
      provenance: result.provenance,
      usage: "usage" in result ? result.usage : undefined,
      determinism,
    },
    judge: {
      status: parsedJudge.status,
      score: parsedJudge.score,
      findings: parsedJudge.findings,
      raw: judgeResult.content,
      provider: judgeResult.provider,
      model: judgeResult.model,
      costUsd: round6(judgeResult.costUsd),
      estimatedCostUsd: round6(judgeResult.estimatedCostUsd),
    },
    baseline: {
      id: baseline.id,
      minimumScore: baseline.minimumScore,
      passed,
      delta: round2(parsedJudge.score - baseline.minimumScore),
    },
  };
}

function buildReviewSuggestions(reportCase: EvalReportCase, findings: string[]): SuggestedArtifactChange[] {
  const findingText = findings.length > 0 ? findings.join("; ") : "Score fell below baseline.";
  return [
    {
      id: `${reportCase.fixtureId}.prompt-diff`,
      kind: "prompt-diff",
      targetPath: `eval/proposals/prompts/${reportCase.fixtureId}.md`,
      reason: findingText,
      diff: [
        `--- /dev/null`,
        `+++ b/eval/proposals/prompts/${reportCase.fixtureId}.md`,
        `@@`,
        `+Review prompt guidance for ${reportCase.intent}:`,
        `+${findingText}`,
      ].join("\n"),
      applied: false,
    },
    {
      id: `${reportCase.fixtureId}.route-hint-diff`,
      kind: "route-hint-diff",
      targetPath: `eval/proposals/route-hints/${reportCase.fixtureId}.json`,
      reason: `Review routing only; do not apply automatically. ${findingText}`,
      diff: [
        `--- /dev/null`,
        `+++ b/eval/proposals/route-hints/${reportCase.fixtureId}.json`,
        `@@`,
        `+{"intent":${JSON.stringify(reportCase.intent)},"reviewOnly":true,"finding":${JSON.stringify(findingText)}}`,
      ].join("\n"),
      applied: false,
    },
  ];
}

function assertFixtureShape(value: unknown, file: string): asserts value is EvalFixture {
  const fixture = value as EvalFixture;
  if (!fixture || typeof fixture !== "object") throw new Error(`${file} contains a non-object fixture`);
  for (const key of ["id", "title", "rubricId", "baselineId"] as const) {
    if (typeof fixture[key] !== "string" || fixture[key].trim() === "") {
      throw new Error(`${file} fixture is missing ${key}`);
    }
  }
  if (!Array.isArray(fixture.tags) || !fixture.tags.every((tag) => typeof tag === "string")) {
    throw new Error(`${file} fixture ${fixture.id} must include tags[]`);
  }
  if (!plainObject(fixture.appShapeMetadata)) throw new Error(`${file} fixture ${fixture.id} must include appShapeMetadata`);
  if (!plainObject(fixture.aiRequest)) throw new Error(`${file} fixture ${fixture.id} must include aiRequest`);
}

function assertRubricShape(value: unknown, file: string): asserts value is EvalRubric {
  const rubric = value as EvalRubric;
  if (!rubric || typeof rubric !== "object" || typeof rubric.id !== "string" || typeof rubric.title !== "string") {
    throw new Error(`${file} contains an invalid rubric`);
  }
  if (!rubric.scale || rubric.scale.min !== 0 || rubric.scale.max !== 5) {
    throw new Error(`${file} rubric ${rubric.id} must use a 0..5 scale`);
  }
  if (!Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
    throw new Error(`${file} rubric ${rubric.id} must include criteria[]`);
  }
  const totalWeight = rubric.criteria.reduce((sum, criterion) => sum + Number(criterion.weight), 0);
  if (Math.abs(totalWeight - 1) > 0.001) {
    throw new Error(`${file} rubric ${rubric.id} criteria weights must sum to 1`);
  }
}

function assertBaselineShape(value: unknown, file: string): asserts value is EvalBaseline {
  const baseline = value as EvalBaseline;
  if (!baseline || typeof baseline !== "object") throw new Error(`${file} contains an invalid baseline`);
  if (typeof baseline.id !== "string" || typeof baseline.fixtureId !== "string") {
    throw new Error(`${file} baseline must include id and fixtureId`);
  }
  if (!Number.isFinite(baseline.minimumScore) || baseline.minimumScore < 0 || baseline.minimumScore > 5) {
    throw new Error(`${file} baseline ${baseline.id} must use minimumScore 0..5`);
  }
}

function assertEvalOutputPath(rootDir: string, filePath: string): void {
  const evalRoot = path.resolve(rootDir, "eval");
  const resolved = path.resolve(filePath);
  const relative = path.relative(evalRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`eval report path must stay under ${evalRoot}`);
  }
}

function requiredMapValue<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (!value) throw new Error(`missing ${label}: ${String(key)}`);
  return value;
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
  return output;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function mockAiRequestResult(response: string): AiRequestResult {
  return {
    ok: true,
    provider: "ollama",
    model: "mock-local-model",
    dataBoundary: "local",
    response,
    structuredResponse: null,
    provenance: {
      routedBy: "prism-spectra",
      sourceApp: "eval-test",
      riskClass: "read-only",
      preferredMode: "local-first",
      graphId: "mock-graph",
      nodeId: "request",
      recorded: false,
      chainTried: [{ provider: "ollama", allowed: true }],
      capabilityManifest: { status: "absent", sourceApp: "eval-test", intent: "eval-test" },
    },
    usage: {
      tokensIn: 10,
      tokensOut: 20,
      cost: 0,
      latencyMs: 1,
    },
  };
}
