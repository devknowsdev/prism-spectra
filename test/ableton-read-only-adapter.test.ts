import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABLETON_READ_ONLY_ADAPTER_ID,
  ABLETON_READ_ONLY_GATE_CONTRACT,
  ABLETON_READ_ONLY_PROTOCOL,
  abletonReadOnlyCapabilityIds,
  executeAbletonReadOnlyRequest,
  isCanonicalAbletonDevicePath,
  planAbletonReadOnlyRequest,
  validateAbletonReadOnlyManifest,
  validateAbletonReadOnlyManifestSet,
  type StagedAbletonReadOnlyManifest,
} from "../src/capabilities/abletonReadOnlyAdapter.js";
import { loadCapabilityManifestRegistry } from "../src/capabilities/capabilityManifestRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const STAGED_DIR = path.join(ROOT, "staged-capabilities", "ableton");

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

function loadStagedValues(): unknown[] {
  return fs.readdirSync(STAGED_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(STAGED_DIR, name), "utf8")));
}

function validatedManifests(): StagedAbletonReadOnlyManifest[] {
  const validation = validateAbletonReadOnlyManifestSet(loadStagedValues());
  assert.equal(validation.valid, true, validation.valid ? undefined : validation.errors.join("\n"));
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  return validation.manifests;
}

async function main() {
  await test("staged schema is valid JSON and names tool-request only", () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(ROOT, "schemas", "ableton-read-only-capability.schema.json"), "utf8"),
    );
    assert.equal(schema.properties.entrypoint.properties.type.const, "tool-request");
    assert.equal(schema.properties.status.const, "disabled");
    assert.equal(schema.properties.disabledByDefault.const, true);
    assert.equal(schema.properties.networkPolicy.properties.mode.const, "none");
  });

  await test("all four staged manifests validate as one closed disabled set", () => {
    const manifests = validatedManifests();
    assert.deepEqual(manifests.map((manifest) => manifest.id), [...abletonReadOnlyCapabilityIds].sort());
    for (const manifest of manifests) {
      assert.equal(manifest.status, "disabled");
      assert.equal(manifest.disabledByDefault, true);
      assert.equal(manifest.riskClass, "read-only");
      assert.equal(manifest.entrypoint.type, "tool-request");
      assert.equal(manifest.entrypoint.adapter, ABLETON_READ_ONLY_ADAPTER_ID);
      assert.equal(manifest.gatingContract, ABLETON_READ_ONLY_GATE_CONTRACT);
      assert.equal(manifest.action.terminalExecution, false);
      assert.equal(manifest.action.fileWritesPossible, false);
      assert.equal(manifest.networkPolicy.mode, "none");
      assert.deepEqual(manifest.allowedPaths, []);
      assert.deepEqual(manifest.allowedEnvVars, []);
    }
  });

  await test("staged manifests are invisible to the active capability registry and AI gateway index", () => {
    const result = loadCapabilityManifestRegistry({
      directory: path.join(ROOT, "capabilities"),
      logger: { warn: () => undefined, error: () => undefined },
    });
    assert.deepEqual(result.issues, []);
    for (const id of abletonReadOnlyCapabilityIds) {
      assert.equal(result.registry.get(id), undefined);
    }
    for (const intent of [
      "get-live-version",
      "inspect-selected-track",
      "inspect-device",
      "list-device-parameters",
    ]) {
      assert.deepEqual(result.registry.matchAiRequest("ableton-copilot", intent), {
        status: "absent",
        sourceApp: "ableton-copilot",
        intent,
      });
    }
  });

  await test("no-path request produces a non-executable correlated plan", () => {
    const result = planAbletonReadOnlyRequest(validatedManifests(), {
      capabilityId: "ableton.live.get_version",
      requestId: "prism-42",
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error(result.error);
    assert.deepEqual(result.plan, {
      adapter: ABLETON_READ_ONLY_ADAPTER_ID,
      protocol: ABLETON_READ_ONLY_PROTOCOL,
      capabilityId: "ableton.live.get_version",
      requestId: "prism-42",
      tool: "get_live_version",
      manifestStatus: "disabled",
      executable: false,
      reason: "runtime_gate_not_approved",
    });
  });

  await test("path request preserves only a canonical device path", () => {
    const result = planAbletonReadOnlyRequest(validatedManifests(), {
      capabilityId: "ableton.live.inspect_device",
      requestId: "inspect-1",
      path: "live_set tracks 0 devices 12",
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error(result.error);
    assert.equal(result.plan.tool, "inspect_device_at_path");
    assert.equal(result.plan.path, "live_set tracks 0 devices 12");
    assert.equal(result.plan.executable, false);
  });

  await test("request fields, request IDs, and capability IDs fail closed", () => {
    const manifests = validatedManifests();
    assert.deepEqual(planAbletonReadOnlyRequest(manifests, null), { ok: false, error: "invalid_request" });
    assert.deepEqual(planAbletonReadOnlyRequest(manifests, {
      capabilityId: "ableton.live.get_version",
      requestId: "valid-id",
      command: "delete_track",
    }), { ok: false, error: "invalid_request" });
    assert.deepEqual(planAbletonReadOnlyRequest(manifests, {
      capabilityId: "ableton.live.get_version",
      requestId: "bad request",
    }), { ok: false, error: "invalid_request_id" });
    assert.deepEqual(planAbletonReadOnlyRequest(manifests, {
      capabilityId: "ableton.live.delete_track",
      requestId: "delete-1",
    }), { ok: false, error: "unknown_capability" });
  });

  await test("path requirements reject missing, unexpected, and non-canonical paths", () => {
    const manifests = validatedManifests();
    assert.deepEqual(planAbletonReadOnlyRequest(manifests, {
      capabilityId: "ableton.live.inspect_device",
      requestId: "missing-path",
    }), { ok: false, error: "missing_path" });
    assert.deepEqual(planAbletonReadOnlyRequest(manifests, {
      capabilityId: "ableton.live.get_version",
      requestId: "extra-path",
      path: "live_set tracks 0 devices 0",
    }), { ok: false, error: "unexpected_path" });

    const invalidPaths = [
      "live_set tracks 01 devices 0",
      "live_set tracks -1 devices 0",
      "live_set tracks 0 devices 1.5",
      "live_app tracks 0 devices 0",
      "live_set view selected_track devices 0",
      "live_set tracks 0 devices 0 parameters 0",
      "live_set return_tracks 0 devices 0",
    ];
    for (const invalidPath of invalidPaths) {
      assert.equal(isCanonicalAbletonDevicePath(invalidPath), false, invalidPath);
      assert.deepEqual(planAbletonReadOnlyRequest(manifests, {
        capabilityId: "ableton.live.list_device_parameters",
        requestId: "path-test",
        path: invalidPath,
      }), { ok: false, error: "invalid_path" });
    }
    assert.equal(isCanonicalAbletonDevicePath("live_set tracks 0 devices 0"), true);
  });

  await test("manifest tampering and permission widening fail closed", () => {
    const source = validatedManifests()[0];
    const mutations: Array<[string, (manifest: Record<string, any>) => void]> = [
      ["enabled status", (manifest) => { manifest.status = "enabled"; }],
      ["widened input", (manifest) => { manifest.allowedInputs.push("command"); }],
      ["widened output", (manifest) => { manifest.allowedOutputs.push("rawLiveApi"); }],
      ["file write", (manifest) => { manifest.action.fileWritesPossible = true; }],
      ["terminal execution", (manifest) => { manifest.action.terminalExecution = true; }],
      ["network host", (manifest) => { manifest.networkPolicy = { mode: "loopback-only", allowedHosts: ["127.0.0.1"] }; }],
      ["wrong adapter", (manifest) => { manifest.entrypoint.adapter = "other-adapter"; }],
      ["wrong action", (manifest) => { manifest.action.name = "delete_track"; }],
      ["unknown field", (manifest) => { manifest.hiddenPermission = true; }],
    ];

    for (const [label, mutate] of mutations) {
      const candidate = structuredClone(source) as unknown as Record<string, any>;
      mutate(candidate);
      const validation = validateAbletonReadOnlyManifest(candidate);
      assert.equal(validation.valid, false, label);
    }
  });

  await test("manifest set rejects duplicates and missing capabilities", () => {
    const values = loadStagedValues();
    const duplicate = validateAbletonReadOnlyManifestSet([...values.slice(0, 3), values[0]]);
    assert.equal(duplicate.valid, false);
    if (!duplicate.valid) assert.match(duplicate.errors.join("\n"), /duplicate|missing/);

    const missing = validateAbletonReadOnlyManifestSet(values.slice(0, 3));
    assert.equal(missing.valid, false);
    if (!missing.valid) assert.match(missing.errors.join("\n"), /missing capability|exactly 4/);
  });

  await test("execution is unconditionally refused", () => {
    assert.deepEqual(executeAbletonReadOnlyRequest(), {
      ok: false,
      error: "adapter_disabled",
      reason: "runtime_gate_not_approved",
    });
  });

  await test("adapter source contains no runtime transport or execution imports", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "src", "capabilities", "abletonReadOnlyAdapter.ts"),
      "utf8",
    );
    for (const forbidden of [
      "node:child_process",
      "node:fs",
      "node:http",
      "node:https",
      "node:net",
      "node:dgram",
      "node:tls",
      "node:worker_threads",
      "WebSocket",
      "fetch(",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
}

main();
