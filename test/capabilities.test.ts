import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadCapabilityManifestRegistry,
  validateSpectraCapabilityManifest,
} from "../src/capabilities/capabilityManifestRegistry.js";
import { ExecutionEngine } from "../src/engine/executionEngine.js";
import { PROVIDER_CONFIGS } from "../src/eval/cloudTeacherProviders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TMP = path.join(ROOT, ".test-tmp", "capabilities");
const logger = {
  warnings: [] as string[],
  errors: [] as string[],
  warn: (...args: unknown[]) => logger.warnings.push(args.join(" ")),
  error: (...args: unknown[]) => logger.errors.push(args.join(" ")),
};

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok  - ${name}`);
  } catch (error) {
    console.error(`  FAIL - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  await test("checked-in capability manifests load and stay slice-1 read-only", () => {
    const result = loadCapabilityManifestRegistry({
      directory: path.join(ROOT, "capabilities"),
      logger,
    });
    assert.equal(result.missing, false);
    assert.deepEqual(result.issues, []);
    assert.equal(result.loaded.length, 12);

    const enabled = result.loaded.filter((manifest) => manifest.status === "enabled");
    assert.equal(enabled.length, 7);
    for (const manifest of enabled) {
      assert.equal(manifest.riskClass, "read-only");
      assert.equal(manifest.executionMode, "read-only");
      assert.equal(manifest.approvalRequired, false);
      assert.equal(manifest.action?.terminalExecution, false);
      assert.equal(manifest.action?.fileWritesPossible, false);
      assert.deepEqual(manifest.allowedPaths, []);
      assert.deepEqual(manifest.allowedEnvVars, []);
    }

    const reserved = result.loaded.filter((manifest) => manifest.status === "reserved");
    assert.deepEqual(reserved.map((manifest) => manifest.entrypoint.domain).sort(), [
      "media",
      "midi/hardware",
      "research-pull",
    ]);
    for (const manifest of reserved) {
      assert.equal(manifest.disabledByDefault, true);
      assert.ok(manifest.gatingContract);
    }
  });

  await test("checked-in cloud teacher provider manifests load through shipped registry", () => {
    const result = loadCapabilityManifestRegistry({
      directory: path.join(ROOT, "capabilities"),
      logger,
    });
    assert.deepEqual(result.issues, []);
    const anthropic = result.registry.get("anthropic.claude");
    const openai = result.registry.get("openai.gpt");
    for (const manifest of [anthropic, openai]) {
      assert.ok(manifest);
      assert.equal(manifest.kind, "model-provider");
      assert.equal(manifest.status, "disabled");
      assert.equal(manifest.disabledByDefault, true);
      assert.equal(manifest.executionMode, "external");
      assert.equal(manifest.riskClass, "external");
      assert.equal(manifest.locality, "external");
      assert.equal(manifest.dataBoundary, "remote_no_training");
      assert.equal(manifest.credentialPolicy.mode, "declared-env");
      assert.equal(manifest.costPolicy.mode, "visible-before-use");
      assert.equal(manifest.entrypoint.type, "explicit-eval-teacher-dispatch");
      assert.deepEqual(manifest.modelProvider?.roles, ["teacher", "judge", "persona-driver"]);
      assert.equal(manifest.modelProvider?.fallbackPolicy, "never-normal-routing");
    }
    assert.deepEqual(anthropic?.credentialPolicy.envVars, ["ANTHROPIC_API_KEY"]);
    assert.deepEqual(openai?.credentialPolicy.envVars, ["OPENAI_API_KEY"]);
  });

  await test("cloud teacher manifests match provider adapter model metadata", () => {
    const result = loadCapabilityManifestRegistry({
      directory: path.join(ROOT, "capabilities"),
      logger,
    });
    assert.deepEqual(result.issues, []);

    for (const manifestId of ["anthropic.claude", "openai.gpt"]) {
      const manifest = result.registry.get(manifestId);
      assert.ok(manifest?.modelProvider);
      assert.ok(manifest.modelProvider.costPerToken);
      const provider = manifest.modelProvider.provider as keyof typeof PROVIDER_CONFIGS;
      const config = PROVIDER_CONFIGS[provider];
      assert.equal(manifest.modelProvider.model, config.defaultModel);
      assert.equal(manifest.modelProvider.contextWindow, config.contextWindow);
      assert.equal(manifest.modelProvider.costPerToken.inputPerMillion, config.inputPerMillionUsd);
      assert.equal(manifest.modelProvider.costPerToken.outputPerMillion, config.outputPerMillionUsd);
    }
  });

  await test("fixture valid manifest registers and matches ai-request telemetry", () => {
    const result = loadCapabilityManifestRegistry({
      directory: path.join(ROOT, "test", "fixtures", "capabilities", "valid"),
      logger,
    });
    assert.deepEqual(result.issues, []);
    assert.equal(result.loaded.length, 2);
    assert.deepEqual(result.registry.matchAiRequest("fixture-app", "fixture.valid"), {
      status: "matched",
      id: "fixture.valid_read_only",
      manifestStatus: "enabled",
      kind: "tool-action",
      riskClass: "read-only",
      disabledByDefault: false,
    });
    assert.deepEqual(result.registry.matchAiRequest("fixture-app", "missing"), {
      status: "absent",
      sourceApp: "fixture-app",
      intent: "missing",
    });
  });

  await test("deliberately invalid fixtures fail closed", () => {
    const result = loadCapabilityManifestRegistry({
      directory: path.join(ROOT, "test", "fixtures", "capabilities", "invalid"),
      logger,
    });
    assert.equal(result.loaded.length, 0);
    assert.equal(result.issues.length, 6);
    const allErrors = result.issues.flatMap((issue) => issue.errors).join("\n");
    assert.match(allErrors, /riskClass must be one of/);
    assert.match(allErrors, /environment variable names/);
    assert.match(allErrors, /must not declare file writes/);
    assert.match(allErrors, /must not declare terminal execution/);
    assert.match(allErrors, /unknown field 'extraPermission'/);
    assert.match(allErrors, /modelProvider.roles entries/);
    assert.match(allErrors, /modelProvider.healthcheck.method/);
    assert.match(allErrors, /modelProvider.healthcheck.endpoint/);
  });

  await test("absent capability directory degrades to current behavior with warning", () => {
    const missing = path.join(TMP, "does-not-exist");
    const localLogger = {
      warnings: [] as string[],
      errors: [] as string[],
      warn: (...args: unknown[]) => localLogger.warnings.push(args.join(" ")),
      error: (...args: unknown[]) => localLogger.errors.push(args.join(" ")),
    };
    const result = loadCapabilityManifestRegistry({ directory: missing, logger: localLogger });
    assert.equal(result.missing, true);
    assert.equal(result.loaded.length, 0);
    assert.equal(result.issues.length, 0);
    assert.equal(result.registry.matchAiRequest("anything", "anything").status, "absent");
    assert.ok(localLogger.warnings.some((warning) => warning.includes("manifest directory absent")));
  });

  await test("loader path rejects hidden terminal execution, file writes, and credential value leakage", () => {
    const invalidDir = path.join(ROOT, "test", "fixtures", "capabilities", "invalid");
    const result = loadCapabilityManifestRegistry({ directory: invalidDir, logger });
    const byName = new Map(result.issues.map((issue) => [path.basename(issue.filePath), issue.errors.join("\n")]));
    assert.match(byName.get("hidden_terminal_execution.json") ?? "", /terminal execution/);
    assert.match(byName.get("hidden_file_write.json") ?? "", /file writes/);
    assert.match(byName.get("credential_leakage.json") ?? "", /environment variable names/);
  });

  await test("schema validator keeps kind-discriminated extensions closed", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "capabilities", "valid", "fixture.valid_read_only.json"), "utf8"));
    raw.modelProvider = {
      role: "planner",
      contextWindow: 1,
      speed: "high",
      qualityTier: "high",
      costClass: "free",
      modalities: ["text"],
      provider: "fixture",
      fallbackPolicy: "none",
    };
    const result = validateSpectraCapabilityManifest(raw);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("must not declare modelProvider")));
  });

  await test("gateway provenance records manifest match and absence without rejection", async () => {
    const engine = new ExecutionEngine({
      dbPath: path.join(TMP, "gateway.db"),
      workDir: path.join(TMP, "work"),
      mockExecutors: true,
      ollamaSwapDelayMs: 1,
      capabilityManifestDirectory: path.join(ROOT, "test", "fixtures", "capabilities", "valid"),
    });
    await engine.init();
    const matched = await engine.runAiRequest({
      sourceApp: "fixture-app",
      intent: "fixture.valid",
      riskClass: "read-only",
      record: false,
      input: { prompt: "ok" },
    });
    assert.equal(matched.ok, true);
    assert.deepEqual(matched.provenance.capabilityManifest, {
      status: "matched",
      id: "fixture.valid_read_only",
      manifestStatus: "enabled",
      kind: "tool-action",
      riskClass: "read-only",
      disabledByDefault: false,
    });

    const absent = await engine.runAiRequest({
      sourceApp: "fixture-app",
      intent: "unmanifested-but-observe-only",
      riskClass: "read-only",
      record: false,
      input: { prompt: "ok" },
    });
    assert.equal(absent.ok, true);
    assert.deepEqual(absent.provenance.capabilityManifest, {
      status: "absent",
      sourceApp: "fixture-app",
      intent: "unmanifested-but-observe-only",
    });
    engine.close();
  });
}

main();
