// test/run.ts
//
// Lightweight assertion-based checks (no framework — `node:assert` is enough
// for this surface area). Each test gets its own fresh DB/workspace so they
// don't interfere with each other or with src/demo.ts's output.

process.env.AI_FORGE_MOCK_EXECUTORS = "1";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ExecutionEngine } from "../src/engine/executionEngine.js";
import { TaskGraph } from "../src/taskGraph/graph.js";
import { GraphBuilder, staticFallbackNodes, toNodeInputs } from "../src/intelligence/graphBuilder.js";
import { TaskHistory } from "../src/memory/taskHistory.js";
import { applyPatch } from "../src/safety/patch.js";
import { LocalModelLock } from "../src/engine/modelLock.js";
import { selectModel as selectOllamaModel } from "../src/executors/ollama.js";
import {
  createFilesystemAdapter,
  createMockExternalPublishingAdapter,
  createMockFilesystemAdapter,
  createMockGitAdapter,
  createMockLocalModelAdapter,
  createAdapterRegistry,
  ensureApprovalAllowed,
  validateAdapterContract,
  type FilesystemOperationOutput,
  type AdapterAction,
} from "../src/adapters/index.js";
import {
  PRISM_SIDECAR_SUFFIX,
  PRISM_SIDECAR_SCHEMA_VERSION,
  MemoryDB,
  buildSidecarPath,
  buildSidecarApprovalReview,
  buildSidecarPlan,
  createInitialSidecar,
  InMemoryApprovalQueue,
  InMemoryPrismEventLedger,
  getWorkbenchAttachment,
  getWorkbenchConversation,
  deriveAttachmentPreviewSummary,
  buildWorkbenchApprovals,
  buildWorkbenchChanges,
  buildWorkbenchResume,
  listWorkbenchAttachments,
  listWorkbenchConversations,
  planLocalFileRoundTrip,
  recommendSidecarAction,
  planSidecarWrite,
  executeSidecarWritePlan,
  runLocalFileSidecarCommand,
  validateLocalFileSidecar,
  updateSidecarHashFields,
  validateSidecarShape,
  ManifestCapabilityRegistry,
  seedCapabilityManifests,
  validateCapabilityManifest,
  type LocalFileRoundTripPlan,
  type LocalFileSidecarCommandInput,
  type LocalFileSidecarCommandResult,
  type SidecarApprovalReview,
  type SidecarRecommendation,
  type SidecarValidationReport,
  type SidecarWriteExecutionResult,
  type SidecarWritePlan,
} from "../src/index.js";
import {
  buildSidecarApprovalReview as buildSidecarApprovalReviewFromIngestBarrel,
  validateLocalFileSidecar as validateLocalFileSidecarFromIngestBarrel,
  type SidecarApprovalReview as SidecarApprovalReviewFromIngest,
  type SidecarValidationReport as SidecarValidationReportFromIngest,
} from "../src/ingest/index.js";
import { dataBoundaryFor } from "../src/types.js";
import { Wizard, MAX_QUESTIONS } from "../src/wizard/wizard.js";
import { spawn } from "node:child_process";
import os from "node:os";
import type { TaskPacket } from "../src/types.js";
import {
  SANDBOX_DIR,
  SANDBOX_FIXTURES_DIR,
  SANDBOX_TMP_DIR,
  assertInsideSandbox,
  getSandboxSeedRelativePaths,
  resetSandboxTmp,
  resolveSandboxTmpPath,
  seedSandboxTmp,
} from "../sandbox/scripts/sandbox-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", ".test-tmp");

function packet(p: Partial<TaskPacket> & Pick<TaskPacket, "intent" | "node_type">): TaskPacket {
  return { context: {}, constraints: [], dependencies: [], ...p };
}

function action(
  id: string,
  capabilityId: string,
  operation: string,
  riskLevel: AdapterAction["riskLevel"],
  input: Record<string, unknown> = {},
  approvalRequired?: AdapterAction["approvalRequired"],
): AdapterAction {
  return {
    id,
    capabilityId,
    kind: "unknown",
    operation,
    input,
    riskLevel,
    approvalRequired,
  };
}

function filesystemAction(
  id: string,
  capabilityId: string,
  operation: string,
  riskLevel: AdapterAction["riskLevel"],
  input: Record<string, unknown> = {},
  approvalRequired?: AdapterAction["approvalRequired"],
): AdapterAction {
  return {
    ...action(id, capabilityId, operation, riskLevel, input, approvalRequired),
    kind: "filesystem",
  };
}

function filesystemOutput<K extends FilesystemOperationOutput["operation"]>(
  result: { output: FilesystemOperationOutput | null },
  operation: K,
): Extract<FilesystemOperationOutput, { operation: K }> {
  assert.ok(result.output, `expected filesystem output for ${operation}`);
  assert.equal(result.output.operation, operation);
  return result.output as Extract<FilesystemOperationOutput, { operation: K }>;
}

function filesystemRoundTripIO(adapter: ReturnType<typeof createFilesystemAdapter>) {
  let seq = 0;

  return {
    statPath: async (filePath: string) => {
      const result = await adapter.execute(
        filesystemAction(`roundtrip-${seq++}`, "statPath", "statPath", "read_only", { path: filePath }),
        {},
      );
      if (!result.success || !result.output) {
        const error = new Error(result.error?.message ?? "statPath failed");
        (error as { code?: string }).code = result.error?.code;
        (error as { details?: unknown }).details = result.error?.details;
        throw error;
      }
      const output = filesystemOutput(result, "statPath");
      return { kind: output.stat.kind, size: output.stat.size };
    },
    readTextFile: async (filePath: string) => {
      const result = await adapter.execute(
        filesystemAction(`roundtrip-${seq++}`, "readTextFile", "readTextFile", "read_only", { path: filePath }),
        {},
      );
      if (!result.success || !result.output) {
        const error = new Error(result.error?.message ?? "readTextFile failed");
        (error as { code?: string }).code = result.error?.code;
        (error as { details?: unknown }).details = result.error?.details;
        throw error;
      }
      const output = filesystemOutput(result, "readTextFile");
      return output.content;
    },
    computeSha256: async (filePath: string) => {
      const result = await adapter.execute(
        filesystemAction(`roundtrip-${seq++}`, "computeSha256", "computeSha256", "read_only", { path: filePath }),
        {},
      );
      if (!result.success || !result.output) {
        const error = new Error(result.error?.message ?? "computeSha256 failed");
        (error as { code?: string }).code = result.error?.code;
        (error as { details?: unknown }).details = result.error?.details;
        throw error;
      }
      const output = filesystemOutput(result, "computeSha256");
      return output.sha256;
    },
  };
}

function tracingFilesystemAdapter(adapter: ReturnType<typeof createFilesystemAdapter>) {
  const operations: string[] = [];
  return {
    operations,
    adapter: {
      ...adapter,
      execute: async (action: AdapterAction, context: Parameters<typeof adapter.execute>[1]) => {
        operations.push(action.operation);
        return adapter.execute(action, context);
      },
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (child && typeof child === "object" && !Object.isFrozen(child)) {
        deepFreeze(child);
      }
    }
  }

  return value;
}

function uploadAttachmentId(payload: unknown, label: string): number {
  const attachment = payload && typeof payload === "object" ? (payload as Record<string, unknown>).attachment : undefined;
  const id = Number(attachment && typeof attachment === "object" ? (attachment as Record<string, unknown>).id : NaN);
  assert.ok(Number.isFinite(id), `${label} response missing a finite attachment id: ${JSON.stringify(payload)}`);
  return id;
}

async function freshEngine(name: string, opts: { ollamaSwapDelayMs?: number } = {}): Promise<ExecutionEngine> {
  const dir = path.join(ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const engine = new ExecutionEngine({
    dbPath: path.join(dir, "forge.db"),
    workDir: path.join(dir, "workspace"),
    ollamaSwapDelayMs: opts.ollamaSwapDelayMs ?? 5,
    mockExecutors: true,
  });
  await engine.init();
  return engine;
}

function freshMemoryDB(name: string): MemoryDB {
  const dir = path.join(ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return new MemoryDB(path.join(dir, "workbench.db"));
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
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
  fs.rmSync(ROOT, { recursive: true, force: true });

  await test("sequential graph respects dependency order and all nodes succeed", async () => {
    const engine = await freshEngine("seq");
    const graph = new TaskGraph("g", "p", [
      { id: "a", packet: packet({ intent: "a", node_type: "docs" }) },
      { id: "b", packet: packet({ intent: "b", node_type: "ui", dependencies: ["a"] }) },
      { id: "c", packet: packet({ intent: "c", node_type: "backend", dependencies: ["b"] }) },
    ]);
    const logs = await engine.run(graph, "sequential");
    assert.equal(logs.length, 3);
    assert.deepEqual(logs.map((l) => l.nodeId), ["a", "b", "c"]); // dependency order, not insertion order
    assert.ok(logs.every((l) => l.status === "success"));
    engine.close();
  });

  await test("cycle in dependencies is rejected at graph construction", async () => {
    assert.throws(() => {
      new TaskGraph("g", "p", [
        { id: "a", packet: packet({ intent: "a", node_type: "docs", dependencies: ["b"] }) },
        { id: "b", packet: packet({ intent: "b", node_type: "docs", dependencies: ["a"] }) },
      ]);
    }, /Cycle detected/);
  });

  await test("pattern cache hit skips execution and reuses original output", async () => {
    const engine = await freshEngine("cache");
    const p = packet({ intent: "same intent", node_type: "docs" });
    const g1 = new TaskGraph("g1", "proj", [{ id: "x", packet: p }]);
    const [first] = await engine.run(g1, "sequential");
    assert.equal(first.cacheHit, false);

    const g2 = new TaskGraph("g2", "proj", [{ id: "y", packet: { ...p } }]);
    const [second] = await engine.run(g2, "sequential");
    assert.equal(second.cacheHit, true);
    assert.equal(g2.get("y").result?.output, g1.get("x").result?.output);
    assert.equal(second.cost, 0);
    engine.close();
  });

  await test("a failed node blocks only its direct dependent; unrelated sibling still succeeds", async () => {
    const engine = await freshEngine("partial-fail");
    const graph = new TaskGraph("g", "p", [
      { id: "flaky", packet: packet({ intent: "flaky", node_type: "backend", context: { simulateFailure: "ollama" } }) },
      { id: "child", packet: packet({ intent: "child", node_type: "backend", dependencies: ["flaky"] }) },
      { id: "grandchild", packet: packet({ intent: "grandchild", node_type: "backend", dependencies: ["child"] }) },
      { id: "sibling", packet: packet({ intent: "sibling", node_type: "docs" }) },
    ]);
    await engine.run(graph, "sequential");
    assert.equal(graph.get("flaky").status, "failed");
    assert.equal(graph.get("child").status, "blocked"); // direct dependent
    assert.equal(graph.get("grandchild").status, "pending"); // never reachable, but NOT explicitly 'blocked' — see graph.ts docblock
    assert.equal(graph.get("sibling").status, "success");
    engine.close();
  });

  await test("git checkpoint is reverted when a node fails (working tree shows no trace of the failed attempt)", async () => {
    const engine = await freshEngine("rollback-git");
    const graph = new TaskGraph("g", "p", [
      {
        id: "writer",
        packet: packet({
          intent: "write then fail",
          node_type: "terminal",
          context: { command: "echo should-not-survive > marker.txt; exit 1" },
        }),
      },
    ]);
    await engine.run(graph, "sequential");
    assert.equal(graph.get("writer").status, "failed");
    const workspaceFile = path.join(ROOT, "rollback-git", "workspace", "marker.txt");
    assert.equal(fs.existsSync(workspaceFile), false, "rollback should have reverted the file write");
    engine.close();
  });

  await test("ledger fallback: exhausting a tier's budget routes the next call to the next tier", async () => {
    const engine = await freshEngine("ledger");
    engine.ledger.setBudget("ollama", { rpmLimit: 0 }); // immediately exhausted
    const graph = new TaskGraph("g", "p", [{ id: "n", packet: packet({ intent: "n", node_type: "ui" }) }]);
    const [log] = await engine.run(graph, "sequential");
    assert.equal(log.provider, "free_tier");
    engine.close();
  });

  await test("terminal node requires an explicit command and never falls back to intent text", async () => {
    const engine = await freshEngine("terminal-guard");
    const graph = new TaskGraph("g", "p", [{ id: "n", packet: packet({ intent: "rm -rf /", node_type: "terminal" }) }]);
    const [log] = await engine.run(graph, "sequential");
    assert.equal(log.status, "failed");
    assert.match(log.error ?? "", /terminal execution disabled in mock mode/);
    engine.close();
  });

  await test("file-level locking serializes nodes sharing a path; independent nodes are unaffected", async () => {
    const engine = await freshEngine("lock");
    const order: string[] = [];
    const ollama = (engine as any).executors.ollama;
    const orig = ollama.execute.bind(ollama);
    ollama.execute = async (p: TaskPacket) => {
      order.push(`start:${p.intent}`);
      await new Promise((r) => setTimeout(r, 30));
      const result = await orig(p);
      order.push(`end:${p.intent}`);
      return result;
    };
    const graph = new TaskGraph("g", "p", [
      { id: "a", packet: packet({ intent: "a", node_type: "ui", filePaths: ["shared.json"] }) },
      { id: "b", packet: packet({ intent: "b", node_type: "ui", filePaths: ["shared.json"] }) },
    ]);
    await engine.run(graph, "parallel");
    // "a" and "b" must not interleave: end:a must come before start:b, or vice versa.
    const aEnd = order.indexOf("end:a");
    const bStart = order.indexOf("start:b");
    const bEnd = order.indexOf("end:b");
    const aStart = order.indexOf("start:a");
    const noInterleave = (aEnd < bStart) || (bEnd < aStart);
    assert.ok(noInterleave, `expected no interleave, got: ${order.join(", ")}`);
    engine.close();
  });

  await test("static fallback templates are valid, acyclic node sets for every wizard mode", async () => {
    for (const mode of ["build_feature", "fix_issue", "create_project", "deploy"] as const) {
      const nodes = staticFallbackNodes("some task", mode);
      assert.ok(nodes.length > 0, `${mode} produced no nodes`);
      // Constructing a TaskGraph throws on cycles/unknown deps — this is the validation we care about.
      assert.doesNotThrow(() => {
        new TaskGraph(`g-${mode}`, "p", toNodeInputs(nodes));
      });
    }
  });

  await test("GraphBuilder.build() degrades to the fallback template when no API key is set", async () => {
    const engine = await freshEngine("graphbuilder-fallback");
    const builder = new GraphBuilder(engine.memory, engine.taskHistory);
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const outcome = await builder.build({ graphId: "g", projectId: "p", description: "add a settings page", mode: "build_feature" });
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;

    assert.equal(outcome.source, "fallback");
    assert.match(outcome.fallbackReason ?? "", /ANTHROPIC_API_KEY/);
    assert.ok(outcome.graph.all().length > 0);
    engine.close();
  });

  await test("GraphBuilder surfaces relevant past failures for a similar new task", async () => {
    const engine = await freshEngine("graphbuilder-failures");
    // Manufacture a failure in this project's history.
    const failGraph = new TaskGraph("g0", "proj-x", [
      { id: "n", packet: packet({ intent: "Sync payment gateway credentials", node_type: "backend", context: { simulateFailure: "ollama" } }) },
    ]);
    await engine.run(failGraph, "sequential");
    assert.equal(failGraph.get("n").status, "failed");

    const builder = new GraphBuilder(engine.memory, new TaskHistory(engine.memory));
    const outcome = await builder.build({ graphId: "g1", projectId: "proj-x", description: "Fix payment gateway credentials sync", mode: "fix_issue" });
    assert.ok(outcome.failureNotesUsed.length >= 1, "expected the prior failure to be surfaced via keyword overlap");
    assert.match(outcome.failureNotesUsed[0].intent, /payment gateway/i);
    engine.close();
  });

  await test("concurrent checkpoints for nodes with NO shared file paths don't race on git's HEAD ref", async () => {
    const engine = await freshEngine("git-race");
    // Many nodes, zero shared filePaths, all ready at once — maximizes the
    // chance of two `git commit` calls landing on the same instant if the
    // checkpoint manager isn't internally serializing git operations.
    const graph = new TaskGraph(
      "g",
      "p",
      Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, packet: packet({ intent: `task ${i}`, node_type: "docs" }) }))
    );
    const logs = await engine.run(graph, "parallel");
    assert.ok(logs.every((l) => l.status === "success"), `expected all to succeed, got: ${JSON.stringify(logs)}`);
    engine.close();
  });

  await test("applyPatch writes files (creating parent dirs), deletes files, and rejects paths escaping workDir", async () => {
    const dir = path.join(ROOT, "apply-patch");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    applyPatch(dir, { edits: [{ path: "nested/dir/file.txt", op: "write", content: "hello" }] });
    assert.equal(fs.readFileSync(path.join(dir, "nested/dir/file.txt"), "utf-8"), "hello");

    applyPatch(dir, { edits: [{ path: "nested/dir/file.txt", op: "delete" }] });
    assert.equal(fs.existsSync(path.join(dir, "nested/dir/file.txt")), false);

    assert.throws(() => applyPatch(dir, { edits: [{ path: "../../escape.txt", op: "write", content: "x" }] }), /escapes the workspace/);
  });

  await test("an AI-tier node (ollama mock) really writes a file via its patch, checkpointed by git", async () => {
    const engine = await freshEngine("patch-write");
    const graph = new TaskGraph("g", "p", [
      { id: "n", packet: packet({ intent: "scaffold a settings page", node_type: "ui", context: { targetFile: "src/settings.ts" }, filePaths: ["src/settings.ts"] }) },
    ]);
    const [log] = await engine.run(graph, "sequential");
    assert.equal(log.status, "success");
    const written = path.join(ROOT, "patch-write", "workspace", "src/settings.ts");
    assert.ok(fs.existsSync(written), "expected the AI-tier node's patch to actually create the file");
    assert.match(fs.readFileSync(written, "utf-8"), /generated by ollama/);
    engine.close();
  });

  await test("a validation failure rolls back a patch-written file, not just terminal-written ones", async () => {
    const engine = await freshEngine("patch-rollback");
    const graph = new TaskGraph("g", "p", [
      {
        id: "n",
        packet: packet({
          intent: "write a config that should fail review",
          node_type: "backend",
          context: {
            targetFile: "config.json",
            // No real build step exists for a mock — force the gate to fail
            // post-hoc the same way a real failing test suite would.
            validate: { testCommand: "test -f config.json && exit 1" },
          },
          filePaths: ["config.json"],
        }),
      },
    ]);
    const [log] = await engine.run(graph, "sequential");
    assert.equal(log.status, "failed");
    const file = path.join(ROOT, "patch-rollback", "workspace", "config.json");
    assert.equal(fs.existsSync(file), false, "rollback should have reverted the patch-written file");
    engine.close();
  });

  await test("a cache hit replays the original patch, not just the text output", async () => {
    const engine = await freshEngine("patch-cache");
    const p = packet({ intent: "generate a constants file", node_type: "docs", context: { targetFile: "constants.ts" }, filePaths: ["constants.ts"] });

    const g1 = new TaskGraph("g1", "proj", [{ id: "a", packet: p }]);
    const [first] = await engine.run(g1, "sequential");
    assert.equal(first.cacheHit, false);
    const file = path.join(ROOT, "patch-cache", "workspace", "constants.ts");
    const originalContent = fs.readFileSync(file, "utf-8");

    fs.rmSync(file); // simulate the file being gone before the cached node runs again
    const g2 = new TaskGraph("g2", "proj", [{ id: "b", packet: { ...p } }]);
    const [second] = await engine.run(g2, "sequential");
    assert.equal(second.cacheHit, true);
    assert.ok(fs.existsSync(file), "cache hit should have replayed the original patch, recreating the file");
    assert.equal(fs.readFileSync(file, "utf-8"), originalContent);
    engine.close();
  });

  await test("LocalModelLock: same-model calls incur no swap delay, a model switch does", async () => {
    const lock = new LocalModelLock(200); // exaggerated but still test-fast, to make the assertion unambiguous
    const t0 = Date.now();
    await lock.run("modelA", async () => {});
    const afterFirst = Date.now() - t0;
    assert.ok(afterFirst < 100, `first call (no prior model) should not delay, took ${afterFirst}ms`);

    const t1 = Date.now();
    await lock.run("modelA", async () => {}); // same model — no delay
    assert.ok(Date.now() - t1 < 100, "same-model call should not pay the swap delay");

    const t2 = Date.now();
    await lock.run("modelB", async () => {}); // different model — pays the delay
    assert.ok(Date.now() - t2 >= 190, "switching models should pay close to the configured swap delay");
    assert.equal(lock.loadedModel(), "modelB");
  });

  await test("selectModel routes coding node types to the coder model and others to the general model", async () => {
    const coder = selectOllamaModel(packet({ intent: "x", node_type: "backend" }));
    const general = selectOllamaModel(packet({ intent: "x", node_type: "docs" }));
    assert.notEqual(coder, general);
    assert.equal(selectOllamaModel(packet({ intent: "x", node_type: "ui" })), coder);
    assert.equal(selectOllamaModel(packet({ intent: "x", node_type: "tests" })), coder);
  });

  await test("two ollama nodes needing DIFFERENT models never run concurrently, even in 'parallel' mode", async () => {
    const engine = await freshEngine("model-lock-integration", { ollamaSwapDelayMs: 30 });
    const order: string[] = [];
    const ollama = (engine as any).executors.ollama;
    const orig = ollama.execute.bind(ollama);
    ollama.execute = async (p: TaskPacket) => {
      order.push(`start:${p.node_type}`);
      await new Promise((r) => setTimeout(r, 20));
      const result = await orig(p);
      order.push(`end:${p.node_type}`);
      return result;
    };
    // "ui" -> coder model, "docs" -> general model: a genuine switch, and the
    // two nodes share no file path, so FileLockManager alone would let them
    // run fully concurrently. The model lock is what has to stop that.
    const graph = new TaskGraph("g", "p", [
      { id: "a", packet: packet({ intent: "a", node_type: "ui" }) },
      { id: "b", packet: packet({ intent: "b", node_type: "docs" }) },
    ]);
    await engine.run(graph, "parallel");
    const aEnd = order.indexOf("end:ui");
    const bStart = order.indexOf("start:docs");
    const bEnd = order.indexOf("end:docs");
    const aStart = order.indexOf("start:ui");
    const noOverlap = (aEnd < bStart) || (bEnd < aStart);
    assert.ok(noOverlap, `expected no overlap between different-model ollama calls, got: ${order.join(", ")}`);
    engine.close();
  });

  await test("data boundary: local providers are 'local', free_tier is flagged as may-train, gpt/claude are not", async () => {
    assert.equal(dataBoundaryFor("ollama"), "local");
    assert.equal(dataBoundaryFor("terminal"), "local");
    assert.equal(dataBoundaryFor("free_tier"), "remote_may_train");
    assert.equal(dataBoundaryFor("gpt"), "remote_no_training");
    assert.equal(dataBoundaryFor("claude"), "remote_no_training");
  });

  await test("data boundary is actually persisted per call, not just computed transiently", async () => {
    const engine = await freshEngine("data-boundary");
    engine.ledger.setBudget("ollama", { rpmLimit: 0 }); // force free_tier
    const graph = new TaskGraph("g", "p", [{ id: "n", packet: packet({ intent: "n", node_type: "ui" }) }]);
    await engine.run(graph, "sequential");
    const summary = engine.taskHistory.dataBoundarySummary("p").map((row) => ({ ...row }));
    assert.deepEqual(summary, [{ dataBoundary: "remote_may_train", count: 1 }]);
    engine.close();
  });

  await test("Wizard never exceeds the 3-question ceiling, for any mode", async () => {
    for (const mode of ["build_feature", "fix_issue", "create_project", "deploy"] as const) {
      const wizard = new Wizard(mode);
      let count = 0;
      let q = wizard.nextQuestion();
      while (q && count <= MAX_QUESTIONS + 1) {
        wizard.answer(q.id, "answer");
        count++;
        q = wizard.nextQuestion();
      }
      assert.ok(count <= MAX_QUESTIONS, `${mode} asked ${count} questions, ceiling is ${MAX_QUESTIONS}`);
    }
  });

  await test("Wizard enforces answering in order and rejects skipping a required question", async () => {
    const wizard = new Wizard("build_feature");
    const first = wizard.nextQuestion()!;
    assert.equal(first.id, "description");
    assert.throws(() => wizard.answer("constraints", "x"), /answer in order/);
    assert.throws(() => wizard.answer("description", ""), /required and cannot be skipped/);
    wizard.answer("description", "a login page");
    assert.equal(wizard.nextQuestion()!.id, "constraints");
  });

  await test("Wizard.buildPlan() refuses to run before all required questions are answered", async () => {
    const engine = await freshEngine("wizard-refuse");
    const builder = new GraphBuilder(engine.memory, engine.taskHistory);
    const wizard = new Wizard("fix_issue");
    await assert.rejects(() => wizard.buildPlan(builder, { graphId: "g", projectId: "p" }), /Cannot build a plan/);
    engine.close();
  });

  await test("WizardPlan withholds the executable graph until confirm() — no code exposure in summary/steps", async () => {
    const engine = await freshEngine("wizard-plan");
    const builder = new GraphBuilder(engine.memory, engine.taskHistory);
    const wizard = new Wizard("build_feature");
    wizard.answer("description", "a password reset flow");
    wizard.answer("constraints", "");
    wizard.answer("testing_focus", "");
    const plan = await wizard.buildPlan(builder, { graphId: "g1", projectId: "p1" });

    assert.equal(plan.confirmed, false);
    assert.ok(plan.steps.length > 0);
    assert.ok(plan.summary.includes("password reset"));
    // The plan's public surface must never leak TaskPacket internals.
    const serialized = JSON.stringify(plan);
    assert.ok(!serialized.includes("node_type"), "plan serialization leaked node_type");
    assert.ok(!serialized.includes("dependencies"), "plan serialization leaked the dependency graph");

    const graph = plan.confirm();
    assert.ok(graph instanceof TaskGraph);
    assert.equal(plan.confirmed, true);

    const logs = await engine.run(graph, "sequential");
    assert.ok(logs.length > 0 && logs.every((l) => l.status === "success"));
    engine.close();
  });

  await test("adapter scaffold registers contracts, reports health, and blocks external writes without approval", async () => {
    const registry = createAdapterRegistry();
    const localModel = createMockLocalModelAdapter();
    const filesystem = createMockFilesystemAdapter({ "hello.txt": "world" });
    const git = createMockGitAdapter();
    const publishing = createMockExternalPublishingAdapter();
    registry.registerAdapter(localModel);
    registry.registerAdapter(filesystem);
    registry.registerAdapter(git);
    registry.registerAdapter(publishing);

    assert.equal(registry.listAdapters().length, 4);
    assert.deepEqual(
      registry.listAdaptersByKind("git").map((adapter) => adapter.id),
      ["mock-git"],
    );

    const health = await registry.checkAdapterHealth("mock-filesystem");
    assert.equal(health.status, "healthy");
    assert.equal(registry.getAdapter(localModel.id)?.id, localModel.id);
    assert.equal(registry.getAdapter(filesystem.id)?.id, filesystem.id);
    assert.equal(registry.getAdapter(git.id)?.id, git.id);
    assert.equal(registry.getAdapter(publishing.id)?.id, publishing.id);

    const modelResult = await localModel.execute(action("m1", "generate", "generate", "read_only", { prompt: "hello" }), {});
    assert.equal(modelResult.success, true);
    assert.equal(modelResult.output?.text, "mock-local-model:generate:hello");

    const readResult = await filesystem.execute(action("a1", "read", "read", "read_only", { path: "hello.txt" }), {});
    assert.equal(readResult.success, true);
    assert.deepEqual(readResult.output, { path: "hello.txt", content: "world" });
    const repeatedRead = await filesystem.execute(action("a1b", "read", "read", "read_only", { path: "hello.txt" }), {});
    assert.deepEqual(repeatedRead.output, readResult.output);

    const writeResult = await filesystem.execute(
      action("a2", "write", "write", "local_write", { path: "notes.txt", content: "local note" }),
      { approval: { granted: true, approver: "tester" } },
    );
    assert.equal(writeResult.success, true);
    assert.deepEqual(writeResult.output, { path: "notes.txt", content: "local note", written: true });

    const blockedPublish = await publishing.execute(action("a3", "publish", "publish", "external_write", { channel: "social" }), {});
    assert.equal(blockedPublish.success, false);
    assert.equal(blockedPublish.blocked, true);
    assert.match(blockedPublish.error?.message ?? "", /explicit approval/i);

    const approvedPublish = await publishing.execute(
      action("a4", "publish", "publish", "external_write", { channel: "social" }),
      { approval: { granted: true, approver: "tester" } },
    );
    assert.equal(approvedPublish.success, true);
    assert.equal(approvedPublish.output?.status, "published");

    const commitResult = await git.execute(action("a5", "commit", "commit", "local_write", { message: "seed commit" }), {});
    assert.equal(commitResult.success, true);
    assert.equal(commitResult.output?.ref, "commit-0001");

    validateAdapterContract(localModel);
    validateAdapterContract(filesystem);
    validateAdapterContract(git);
    validateAdapterContract(publishing);
  });

  await test("prism local file sidecar helpers follow the required metadata contract", async () => {
    const sourcePath = path.join("content", "song.md");
    assert.equal(PRISM_SIDECAR_SUFFIX, ".prism.json");
    assert.equal(PRISM_SIDECAR_SCHEMA_VERSION, 1);
    assert.equal(buildSidecarPath(sourcePath), `${sourcePath}.prism.json`);

    const initial = createInitialSidecar({
      assetId: "asset-song-001",
      sourcePath,
      canonicalPath: sourcePath,
      kind: "markdown",
      tags: ["music", "draft"],
      derivedFiles: ["content/song.txt"],
      notes: ["seeded for planning"],
    });
    assert.equal(initial.schemaVersion, 1);
    assert.equal(initial.assetId, "asset-song-001");
    assert.equal(initial.sourcePath, sourcePath);
    assert.equal(initial.canonicalPath, sourcePath);
    assert.equal(initial.kind, "markdown");
    assert.deepEqual(initial.tags, ["music", "draft"]);
    assert.deepEqual(initial.derivedFiles, ["content/song.txt"]);
    assert.deepEqual(initial.notes, ["seeded for planning"]);
    assert.equal(initial.sha256, "");
    assert.equal(initial.sizeBytes, 0);
    assert.equal(initial.analysisStatus, "pending");
    assert.equal(initial.approvalState, "unreviewed");

    const validated = validateSidecarShape(initial);
    assert.equal(validated.ok, true);
    assert.deepEqual(validated.issues, []);
    assert.equal(validated.sidecar?.schemaVersion, 1);
    assert.equal(validated.sidecar?.assetId, "asset-song-001");
    assert.equal(validated.sidecar?.canonicalPath, sourcePath);

    const legacySidecar = { ...initial };
    delete (legacySidecar as { schemaVersion?: number }).schemaVersion;
    const legacyValidated = validateSidecarShape(legacySidecar);
    assert.equal(legacyValidated.ok, true);
    assert.deepEqual(legacyValidated.issues, []);
    assert.equal(legacyValidated.sidecar?.schemaVersion, undefined);

    const unsupportedVersion = validateSidecarShape({ ...initial, schemaVersion: 999 });
    assert.equal(unsupportedVersion.ok, false);
    assert.ok(unsupportedVersion.issues.includes("unsupported_schemaVersion"));

    const updated = updateSidecarHashFields(initial, {
      sha256: createHash("sha256").update("song-data").digest("hex"),
      sizeBytes: 9,
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
    assert.equal(updated.sha256, createHash("sha256").update("song-data").digest("hex"));
    assert.equal(updated.sizeBytes, 9);
    assert.equal(updated.updatedAt, "2026-06-23T00:00:00.000Z");

    const malformed = validateSidecarShape({
      assetId: 123,
      sourcePath,
      canonicalPath: sourcePath,
      sha256: 42,
      sizeBytes: -1,
      createdAt: "",
      updatedAt: "",
      kind: "",
      tags: ["ok", 1],
      derivedFiles: [1],
      analysisStatus: "",
      approvalState: "",
      notes: [1],
    });
    assert.equal(malformed.ok, false);
    assert.ok(malformed.issues.length > 0);

    const missingPlan = buildSidecarPlan({ sourcePath });
    assert.equal(missingPlan.status, "candidate");
    assert.equal(missingPlan.sidecarStatus, "missing");
    assert.deepEqual(missingPlan.reasons, ["missing_sidecar"]);
    assert.equal(missingPlan.sidecarPath, `${sourcePath}.prism.json`);

    const readyPlan = buildSidecarPlan({ sourcePath }, initial);
    assert.equal(readyPlan.status, "ready");
    assert.equal(readyPlan.sidecarStatus, "present");
    assert.equal(readyPlan.sidecar?.assetId, "asset-song-001");

    const blockedPlan = buildSidecarPlan({ sourcePath }, { ...initial, sourcePath: "elsewhere.md" });
    assert.equal(blockedPlan.status, "blocked");
    assert.equal(blockedPlan.sidecarStatus, "invalid");
    assert.deepEqual(blockedPlan.reasons, ["source_path_mismatch"]);
  });

  await test("unsupported future schema versions are rejected without migration", async () => {
    const fsRoot = path.join(ROOT, "sidecar-schema-version");
    fs.rmSync(fsRoot, { recursive: true, force: true });
    fs.mkdirSync(fsRoot, { recursive: true });
    fs.mkdirSync(path.join(fsRoot, "notes"), { recursive: true });

    const adapter = createFilesystemAdapter({
      id: "filesystem-sidecar-schema-version",
      allowedRoots: [fsRoot],
      baseDir: fsRoot,
    });
    const io = filesystemRoundTripIO(adapter);

    const sourcePath = path.join("notes", "future.txt");
    fs.writeFileSync(path.join(fsRoot, sourcePath), "future content");
    const futureSidecar = createInitialSidecar({
      assetId: "asset-future-001",
      sourcePath,
      canonicalPath: sourcePath,
      kind: "note",
      sha256: "abc",
      sizeBytes: 3,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: ["draft"],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    const unsupportedFutureSidecar = { ...futureSidecar, schemaVersion: 999 };
    fs.writeFileSync(path.join(fsRoot, `${sourcePath}.prism.json`), `${JSON.stringify(unsupportedFutureSidecar, null, 2)}\n`);

    const plan = await planLocalFileRoundTrip({ sourcePath, filesystem: io });
    assert.equal(plan.sidecarStatus, "malformed");
    assert.equal(plan.recommendedAction, "review_sidecar");
    assert.ok(plan.reasons.includes("unsupported_schemaVersion"));

    const recommendation = recommendSidecarAction(plan, { now: () => "2026-06-23T01:02:03.000Z" });
    assert.equal(recommendation.action, "review_sidecar");
    assert.equal(recommendation.reason, "sidecar_malformed");
    assert.equal(recommendation.draft, undefined);
    assert.equal(recommendation.patch, undefined);

    const writePlan = planSidecarWrite(recommendation);
    assert.equal(writePlan.status, "blocked");
    assert.equal(writePlan.operation, "none");

    const commandResult = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath,
      filesystemAdapter: adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(commandResult.status, "blocked");
    assert.equal(commandResult.recommendation.action, "review_sidecar");
    assert.equal(commandResult.writePlan.status, "blocked");
    assert.equal(commandResult.execution, undefined);
    assert.equal(fs.readFileSync(path.join(fsRoot, `${sourcePath}.prism.json`), "utf-8"), `${JSON.stringify(unsupportedFutureSidecar, null, 2)}\n`);
  });

  await test("sidecar validation report summarizes one explicit file without writing", async () => {
    assert.equal(typeof validateLocalFileSidecarFromIngestBarrel, "function");

    const fsRoot = path.join(ROOT, "sidecar-validation-report");
    fs.rmSync(fsRoot, { recursive: true, force: true });
    fs.mkdirSync(fsRoot, { recursive: true });
    fs.mkdirSync(path.join(fsRoot, "notes"), { recursive: true });

    const traced = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-validation-report",
        allowedRoots: [fsRoot],
        baseDir: fsRoot,
      }),
    );
    const io = filesystemRoundTripIO(traced.adapter);

    const currentSourcePath = path.join("notes", "current.txt");
    const currentContent = "current content";
    const currentHash = createHash("sha256").update(currentContent).digest("hex");
    fs.writeFileSync(path.join(fsRoot, currentSourcePath), currentContent);
    fs.writeFileSync(
      path.join(fsRoot, `${currentSourcePath}.prism.json`),
      `${JSON.stringify(
        createInitialSidecar({
          assetId: "asset-notes-current.txt",
          sourcePath: currentSourcePath,
          canonicalPath: currentSourcePath,
          kind: "note",
          sha256: currentHash,
          sizeBytes: Buffer.byteLength(currentContent),
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
          tags: [],
          derivedFiles: [],
          analysisStatus: "pending",
          approvalState: "unreviewed",
          notes: [],
        }),
        null,
        2,
      )}\n`,
    );
    const currentReport = await validateLocalFileSidecar({ sourcePath: currentSourcePath, filesystem: io });
    assert.equal(currentReport.status, "valid");
    assert.equal(currentReport.sourceStatus, "present");
    assert.equal(currentReport.sidecarStatus, "valid");
    assert.equal(currentReport.schemaVersionStatus, "current");
    assert.equal(currentReport.recommendedAction, "none");
    assert.deepEqual(currentReport.issues, []);
    assert.equal(currentReport.canAutoPlan, false);
    assert.equal(currentReport.canExecuteWithApproval, false);
    const currentRoundTrip: SidecarValidationReport = JSON.parse(JSON.stringify(currentReport));
    assert.equal(currentRoundTrip.status, "valid");
    const currentRoundTripFromIngest: SidecarValidationReportFromIngest = JSON.parse(JSON.stringify(currentReport));
    assert.equal(currentRoundTripFromIngest.schemaVersionStatus, "current");

    const legacySourcePath = path.join("notes", "legacy.txt");
    const legacyContent = "legacy content";
    const legacyHash = createHash("sha256").update(legacyContent).digest("hex");
    fs.writeFileSync(path.join(fsRoot, legacySourcePath), legacyContent);
    const legacySidecar = createInitialSidecar({
      assetId: "asset-notes-legacy.txt",
      sourcePath: legacySourcePath,
      canonicalPath: legacySourcePath,
      kind: "note",
      sha256: legacyHash,
      sizeBytes: Buffer.byteLength(legacyContent),
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: ["legacy"],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    delete (legacySidecar as { schemaVersion?: number }).schemaVersion;
    fs.writeFileSync(path.join(fsRoot, `${legacySourcePath}.prism.json`), `${JSON.stringify(legacySidecar, null, 2)}\n`);
    const legacyReport = await validateLocalFileSidecar({ sourcePath: legacySourcePath, filesystem: io });
    assert.equal(legacyReport.status, "valid");
    assert.equal(legacyReport.schemaVersionStatus, "legacy_missing");
    assert.equal(legacyReport.recommendedAction, "none");
    assert.equal(legacyReport.issues.length, 1);
    assert.equal(legacyReport.issues[0].code, "legacy_schemaVersion_missing");
    assert.equal(legacyReport.issues[0].severity, "warning");
    assert.equal(legacyReport.canAutoPlan, false);
    assert.equal(legacyReport.canExecuteWithApproval, false);
    assert.equal(JSON.parse(JSON.stringify(legacyReport)).schemaVersionStatus, "legacy_missing");

    const futureSourcePath = path.join("notes", "future.txt");
    const futureContent = "future content";
    fs.writeFileSync(path.join(fsRoot, futureSourcePath), futureContent);
    const futureSidecar = createInitialSidecar({
      assetId: "asset-notes-future.txt",
      sourcePath: futureSourcePath,
      canonicalPath: futureSourcePath,
      kind: "note",
      sha256: "old-hash",
      sizeBytes: 3,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: [],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    fs.writeFileSync(path.join(fsRoot, `${futureSourcePath}.prism.json`), `${JSON.stringify({ ...futureSidecar, schemaVersion: 999 }, null, 2)}\n`);
    const futureReport = await validateLocalFileSidecar({ sourcePath: futureSourcePath, filesystem: io });
    assert.equal(futureReport.status, "review_needed");
    assert.equal(futureReport.schemaVersionStatus, "unsupported");
    assert.equal(futureReport.recommendedAction, "review_sidecar");
    assert.equal(futureReport.canAutoPlan, false);
    assert.equal(futureReport.canExecuteWithApproval, false);
    assert.ok(futureReport.issues.some((issue) => issue.code === "unsupported_schemaVersion"));
    assert.equal(JSON.parse(JSON.stringify(futureReport)).status, "review_needed");

    const missingSourcePath = path.join("notes", "missing.txt");
    const missingSourceReport = await validateLocalFileSidecar({ sourcePath: missingSourcePath, filesystem: io });
    assert.equal(missingSourceReport.status, "blocked");
    assert.equal(missingSourceReport.recommendedAction, "blocked");
    assert.equal(missingSourceReport.canAutoPlan, false);
    assert.equal(missingSourceReport.canExecuteWithApproval, false);

    const missingSidecarSourcePath = path.join("notes", "draft.txt");
    const missingContent = "draft content";
    fs.writeFileSync(path.join(fsRoot, missingSidecarSourcePath), missingContent);
    const missingSidecarReport = await validateLocalFileSidecar({ sourcePath: missingSidecarSourcePath, filesystem: io });
    assert.equal(missingSidecarReport.status, "missing");
    assert.equal(missingSidecarReport.sidecarStatus, "missing");
    assert.equal(missingSidecarReport.schemaVersionStatus, "not_applicable");
    assert.equal(missingSidecarReport.recommendedAction, "create_sidecar");
    assert.equal(missingSidecarReport.canAutoPlan, true);
    assert.equal(missingSidecarReport.canExecuteWithApproval, true);
    assert.equal(JSON.parse(JSON.stringify(missingSidecarReport)).status, "missing");

    const staleSourcePath = path.join("notes", "stale.txt");
    const staleContent = "stale content";
    fs.writeFileSync(path.join(fsRoot, staleSourcePath), staleContent);
    fs.writeFileSync(
      path.join(fsRoot, `${staleSourcePath}.prism.json`),
      `${JSON.stringify(
        createInitialSidecar({
          assetId: "asset-notes-stale.txt",
          sourcePath: staleSourcePath,
          canonicalPath: staleSourcePath,
          kind: "note",
          sha256: "old-hash",
          sizeBytes: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
          tags: ["draft"],
          derivedFiles: [],
          analysisStatus: "pending",
          approvalState: "unreviewed",
          notes: [],
        }),
        null,
        2,
      )}\n`,
    );
    const staleReport = await validateLocalFileSidecar({ sourcePath: staleSourcePath, filesystem: io });
    assert.equal(staleReport.status, "review_needed");
    assert.equal(staleReport.schemaVersionStatus, "current");
    assert.equal(staleReport.recommendedAction, "update_sidecar_hash");
    assert.equal(staleReport.canAutoPlan, true);
    assert.equal(staleReport.canExecuteWithApproval, true);
    assert.ok(staleReport.issues.some((issue) => issue.code === "sha256_mismatch"));
    assert.ok(staleReport.issues.some((issue) => issue.code === "sizeBytes_mismatch"));
    assert.equal(JSON.parse(JSON.stringify(staleReport)).recommendedAction, "update_sidecar_hash");

    const malformedSourcePath = path.join("notes", "broken.txt");
    fs.writeFileSync(path.join(fsRoot, malformedSourcePath), "broken content");
    fs.writeFileSync(path.join(fsRoot, `${malformedSourcePath}.prism.json`), "{ not json");
    const malformedReport = await validateLocalFileSidecar({ sourcePath: malformedSourcePath, filesystem: io });
    assert.equal(malformedReport.status, "review_needed");
    assert.equal(malformedReport.sidecarStatus, "malformed");
    assert.equal(malformedReport.schemaVersionStatus, "not_applicable");
    assert.equal(malformedReport.recommendedAction, "review_sidecar");
    assert.equal(malformedReport.canAutoPlan, false);
    assert.equal(malformedReport.canExecuteWithApproval, false);
    assert.ok(malformedReport.issues.some((issue) => issue.code === "sidecar_json_malformed"));

    const mismatchedSourcePath = path.join("notes", "mismatch.txt");
    fs.writeFileSync(path.join(fsRoot, mismatchedSourcePath), "mismatch content");
    fs.writeFileSync(
      path.join(fsRoot, `${mismatchedSourcePath}.prism.json`),
      `${JSON.stringify(
        createInitialSidecar({
          assetId: "asset-notes-other.txt",
          sourcePath: "notes/other.txt",
          canonicalPath: "notes/other.txt",
          kind: "note",
          sha256: "old-hash",
          sizeBytes: 4,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
          tags: [],
          derivedFiles: [],
          analysisStatus: "pending",
          approvalState: "unreviewed",
          notes: [],
        }),
        null,
        2,
      )}\n`,
    );
    const mismatchedReport = await validateLocalFileSidecar({ sourcePath: mismatchedSourcePath, filesystem: io });
    assert.equal(mismatchedReport.status, "review_needed");
    assert.equal(mismatchedReport.sidecarStatus, "mismatched_source");
    assert.equal(mismatchedReport.schemaVersionStatus, "current");
    assert.equal(mismatchedReport.recommendedAction, "review_sidecar");
    assert.equal(mismatchedReport.canAutoPlan, false);
    assert.equal(mismatchedReport.canExecuteWithApproval, false);
    assert.ok(mismatchedReport.issues.some((issue) => issue.code === "source_path_mismatch"));

    const blockedReport = await validateLocalFileSidecar({ sourcePath: path.join("..", "escape.txt"), filesystem: io });
    assert.equal(blockedReport.status, "blocked");
    assert.equal(blockedReport.sidecarStatus, "blocked");
    assert.equal(blockedReport.recommendedAction, "blocked");
    assert.equal(blockedReport.canAutoPlan, false);
    assert.equal(blockedReport.canExecuteWithApproval, false);
    assert.ok(blockedReport.issues.length > 0);

    assert.ok(!traced.operations.includes("writeJsonFile"));
    assert.ok(!traced.operations.includes("writeTextFile"));
    assert.ok(!traced.operations.includes("unlink"));
  });

  await test("sidecar approval review converts read-only sidecar states into caller-facing approval models", async () => {
    assert.equal(typeof buildSidecarApprovalReviewFromIngestBarrel, "function");

    const fsRoot = path.join(ROOT, "sidecar-approval-review");
    fs.rmSync(fsRoot, { recursive: true, force: true });
    fs.mkdirSync(fsRoot, { recursive: true });
    fs.mkdirSync(path.join(fsRoot, "notes"), { recursive: true });

    const adapter = createFilesystemAdapter({
      id: "filesystem-sidecar-approval-review",
      allowedRoots: [fsRoot],
      baseDir: fsRoot,
    });
    const io = filesystemRoundTripIO(adapter);

    const createSourcePath = path.join("notes", "draft.txt");
    fs.writeFileSync(path.join(fsRoot, createSourcePath), "draft content");
    const createPlan = planSidecarWrite(
      recommendSidecarAction(
        await planLocalFileRoundTrip({ sourcePath: createSourcePath, filesystem: io }),
        { now: () => "2026-06-23T01:02:03.000Z" },
      ),
    );

    const createReview = buildSidecarApprovalReview({ writePlan: createPlan });
    assert.equal(createReview.status, "approval_required");
    assert.equal(createReview.approvalType, "local_write");
    assert.equal(createReview.proposedOperation, "create_sidecar");
    assert.equal(createReview.canApprove, true);
    assert.equal(createReview.riskLevel, "low");
    assert.ok(createReview.userFacingChanges.includes("schemaVersion"));
    assert.equal(JSON.parse(JSON.stringify(createReview)).status, "approval_required");
    const createRoundTrip: SidecarApprovalReview = JSON.parse(JSON.stringify(createReview));
    assert.equal(createRoundTrip.approvalType, "local_write");
    const createRoundTripFromIngest: SidecarApprovalReviewFromIngest = JSON.parse(JSON.stringify(createReview));
    assert.equal(createRoundTripFromIngest.proposedOperation, "create_sidecar");

    const staleSourcePath = path.join("notes", "stale.txt");
    fs.writeFileSync(path.join(fsRoot, staleSourcePath), "stale content");
    fs.writeFileSync(
      path.join(fsRoot, `${staleSourcePath}.prism.json`),
      `${JSON.stringify(
        createInitialSidecar({
          assetId: "asset-notes-stale.txt",
          sourcePath: staleSourcePath,
          canonicalPath: staleSourcePath,
          kind: "note",
          sha256: "old-hash",
          sizeBytes: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
          tags: ["draft"],
          derivedFiles: [],
          analysisStatus: "pending",
          approvalState: "unreviewed",
          notes: [],
        }),
        null,
        2,
      )}\n`,
    );
    const stalePlan = planSidecarWrite(
      recommendSidecarAction(
        await planLocalFileRoundTrip({ sourcePath: staleSourcePath, filesystem: io }),
        { now: () => "2026-06-23T01:02:03.000Z" },
      ),
    );
    const staleReview = buildSidecarApprovalReview({ writePlan: stalePlan });
    assert.equal(staleReview.status, "approval_required");
    assert.equal(staleReview.proposedOperation, "update_sidecar");
    assert.equal(staleReview.canApprove, true);
    assert.deepEqual(staleReview.userFacingChanges, ["sha256", "sizeBytes", "updatedAt"]);

    const readyReport: SidecarValidationReport = {
      status: "valid",
      sourcePath: "notes/ready.txt",
      sidecarPath: "notes/ready.txt.prism.json",
      sourceStatus: "present",
      sidecarStatus: "valid",
      schemaVersionStatus: "current",
      issues: [],
      recommendedAction: "none",
      canAutoPlan: false,
      canExecuteWithApproval: false,
    };
    const readyReview = buildSidecarApprovalReview({ validationReport: readyReport });
    assert.equal(readyReview.status, "not_applicable");
    assert.equal(readyReview.approvalType, "none");
    assert.equal(readyReview.proposedOperation, "none");
    assert.equal(readyReview.canApprove, false);

    const malformedReport: SidecarValidationReport = {
      status: "review_needed",
      sourcePath: "notes/broken.txt",
      sidecarPath: "notes/broken.txt.prism.json",
      sourceStatus: "present",
      sidecarStatus: "malformed",
      schemaVersionStatus: "not_applicable",
      issues: [{ code: "sidecar_json_malformed", severity: "error", message: "Sidecar JSON could not be parsed." }],
      recommendedAction: "review_sidecar",
      canAutoPlan: false,
      canExecuteWithApproval: false,
    };
    const malformedReview = buildSidecarApprovalReview({ validationReport: malformedReport });
    assert.equal(malformedReview.status, "blocked");
    assert.equal(malformedReview.canApprove, false);
    assert.equal(malformedReview.riskLevel, "blocked");

    const futureReport: SidecarValidationReport = {
      status: "review_needed",
      sourcePath: "notes/future.txt",
      sidecarPath: "notes/future.txt.prism.json",
      sourceStatus: "present",
      sidecarStatus: "valid",
      schemaVersionStatus: "unsupported",
      issues: [{ code: "unsupported_schemaVersion", severity: "error", message: "Sidecar schemaVersion is unsupported and requires review." }],
      recommendedAction: "review_sidecar",
      canAutoPlan: false,
      canExecuteWithApproval: false,
    };
    const futureReview = buildSidecarApprovalReview({ validationReport: futureReport });
    assert.equal(futureReview.status, "blocked");
    assert.equal(futureReview.canApprove, false);

    const blockedReport: SidecarValidationReport = {
      status: "blocked",
      sourcePath: "notes/escape.txt",
      sidecarPath: "notes/escape.txt.prism.json",
      sourceStatus: "blocked",
      sidecarStatus: "blocked",
      schemaVersionStatus: "not_applicable",
      issues: [{ code: "path_traversal_blocked", severity: "error", message: "Path traversal was blocked." }],
      recommendedAction: "blocked",
      canAutoPlan: false,
      canExecuteWithApproval: false,
    };
    const blockedReview = buildSidecarApprovalReview({ validationReport: blockedReport });
    assert.equal(blockedReview.status, "blocked");
    assert.equal(blockedReview.canApprove, false);

    const frozenInput = deepFreeze({
      writePlan: deepFreeze({
        ...stalePlan,
        reasons: [...stalePlan.reasons],
        warnings: [...stalePlan.warnings],
        safetyChecks: [...stalePlan.safetyChecks],
      }),
    });
    const frozenSnapshot = JSON.stringify(frozenInput);
    const frozenReview = buildSidecarApprovalReview(frozenInput);
    assert.equal(frozenReview.status, "approval_required");
    assert.equal(JSON.stringify(frozenInput), frozenSnapshot);
    assert.equal(JSON.parse(JSON.stringify(frozenReview)).canApprove, true);

    const plannerReview = buildSidecarApprovalReview({
      planner: await planLocalFileRoundTrip({ sourcePath: createSourcePath, filesystem: io }),
    });
    assert.equal(plannerReview.status, "approval_required");
    assert.equal(plannerReview.approvalType, "local_write");
    assert.equal(plannerReview.canApprove, true);
  });

  await test("explicit file round-trip planner classifies source and adjacent sidecar safely", async () => {
    const roundtripRoot = path.join(ROOT, "roundtrip");
    fs.rmSync(roundtripRoot, { recursive: true, force: true });
    fs.mkdirSync(roundtripRoot, { recursive: true });

    const adapter = createFilesystemAdapter({
      id: "filesystem-roundtrip",
      allowedRoots: [roundtripRoot],
      baseDir: roundtripRoot,
    });
    const io = filesystemRoundTripIO(adapter);

    const missingSidecarSourcePath = path.join("notes", "draft.txt");
    fs.mkdirSync(path.join(roundtripRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(roundtripRoot, missingSidecarSourcePath), "draft content");
    const missingSidecarPlan = await planLocalFileRoundTrip({ sourcePath: missingSidecarSourcePath, filesystem: io });
    assert.equal(missingSidecarPlan.sourceStatus, "present");
    assert.equal(missingSidecarPlan.sidecarStatus, "missing");
    assert.equal(missingSidecarPlan.recommendedAction, "create_sidecar");
    assert.equal(missingSidecarPlan.sidecarPath, `${missingSidecarSourcePath}.prism.json`);
    assert.equal(missingSidecarPlan.sourceFacts?.sizeBytes, Buffer.byteLength("draft content"));

    const readySourcePath = path.join("notes", "ready.txt");
    const readyContent = "ready content";
    const readyHash = createHash("sha256").update(readyContent).digest("hex");
    const readySidecar = createInitialSidecar({
      assetId: "asset-ready-001",
      sourcePath: readySourcePath,
      canonicalPath: readySourcePath,
      kind: "note",
      sha256: readyHash,
      sizeBytes: Buffer.byteLength(readyContent),
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: ["roundtrip"],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    fs.writeFileSync(path.join(roundtripRoot, readySourcePath), readyContent);
    fs.writeFileSync(path.join(roundtripRoot, `${readySourcePath}.prism.json`), JSON.stringify(readySidecar, null, 2) + "\n");
    const readyPlan = await planLocalFileRoundTrip({ sourcePath: readySourcePath, filesystem: io });
    assert.equal(readyPlan.sourceStatus, "present");
    assert.equal(readyPlan.sidecarStatus, "valid");
    assert.equal(readyPlan.recommendedAction, "ready");
    assert.equal(readyPlan.sourceFacts?.sizeBytes, Buffer.byteLength(readyContent));
    assert.equal(readyPlan.sourceFacts?.sha256, readyHash);
    assert.equal(readyPlan.sidecar?.assetId, "asset-ready-001");

    const staleSourcePath = path.join("notes", "stale.txt");
    const staleContent = "stale content";
    const staleHash = createHash("sha256").update(staleContent).digest("hex");
    const staleSidecar = createInitialSidecar({
      assetId: "asset-stale-001",
      sourcePath: staleSourcePath,
      canonicalPath: staleSourcePath,
      kind: "note",
      sha256: "not-the-source-hash",
      sizeBytes: 123,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: [],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    fs.writeFileSync(path.join(roundtripRoot, staleSourcePath), staleContent);
    fs.writeFileSync(path.join(roundtripRoot, `${staleSourcePath}.prism.json`), JSON.stringify(staleSidecar, null, 2) + "\n");
    const stalePlan = await planLocalFileRoundTrip({ sourcePath: staleSourcePath, filesystem: io });
    assert.equal(stalePlan.sidecarStatus, "stale");
    assert.equal(stalePlan.recommendedAction, "update_sidecar_hash");
    assert.equal(stalePlan.sourceFacts?.sha256, staleHash);
    assert.deepEqual(stalePlan.reasons.sort(), ["sha256_mismatch", "sizeBytes_mismatch"]);

    const malformedSourcePath = path.join("notes", "broken.txt");
    fs.writeFileSync(path.join(roundtripRoot, malformedSourcePath), "broken content");
    fs.writeFileSync(path.join(roundtripRoot, `${malformedSourcePath}.prism.json`), "{ not json");
    const malformedPlan = await planLocalFileRoundTrip({ sourcePath: malformedSourcePath, filesystem: io });
    assert.equal(malformedPlan.sidecarStatus, "malformed");
    assert.equal(malformedPlan.recommendedAction, "review_sidecar");
    assert.ok(malformedPlan.reasons.some((reason) => reason.includes("malformed")));

    const mismatchedSourcePath = path.join("notes", "mismatch.txt");
    const mismatchedSidecar = createInitialSidecar({
      assetId: "asset-mismatch-001",
      sourcePath: "notes/other.txt",
      canonicalPath: "notes/other.txt",
      kind: "note",
      sha256: "abc",
      sizeBytes: 3,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: [],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    fs.writeFileSync(path.join(roundtripRoot, mismatchedSourcePath), "mismatch content");
    fs.writeFileSync(path.join(roundtripRoot, `${mismatchedSourcePath}.prism.json`), JSON.stringify(mismatchedSidecar, null, 2) + "\n");
    const mismatchedPlan = await planLocalFileRoundTrip({ sourcePath: mismatchedSourcePath, filesystem: io });
    assert.equal(mismatchedPlan.sidecarStatus, "mismatched_source");
    assert.equal(mismatchedPlan.recommendedAction, "review_sidecar");
    assert.equal(mismatchedPlan.sidecar?.sourcePath, "notes/other.txt");

    const missingSourcePlan = await planLocalFileRoundTrip({
      sourcePath: path.join("notes", "missing.txt"),
      filesystem: io,
    });
    assert.equal(missingSourcePlan.sourceStatus, "missing");
    assert.equal(missingSourcePlan.sidecarStatus, "blocked");
    assert.equal(missingSourcePlan.recommendedAction, "blocked");

    const blockedPlan = await planLocalFileRoundTrip({
      sourcePath: path.join("..", "escape.txt"),
      filesystem: io,
    });
    assert.equal(blockedPlan.sourceStatus, "blocked");
    assert.equal(blockedPlan.sidecarStatus, "blocked");
    assert.equal(blockedPlan.recommendedAction, "blocked");
  });

  await test("sidecar recommendations stay read-only and propose drafts or patches only", async () => {
    const fixedNow = () => "2026-06-23T01:02:03.000Z";

    const missingPlan = {
      sourcePath: "notes/draft.txt",
      sidecarPath: "notes/draft.txt.prism.json",
      sourceStatus: "present" as const,
      sidecarStatus: "missing" as const,
      sourceFacts: {
        sizeBytes: 13,
        sha256: createHash("sha256").update("draft content").digest("hex"),
      },
      sidecar: null,
      reasons: ["sidecar_missing"],
      recommendedAction: "create_sidecar" as const,
    };
    const missingPlanSnapshot = JSON.stringify(missingPlan);
    const missingRecommendation = recommendSidecarAction(missingPlan, { now: fixedNow });
    assert.equal(JSON.stringify(missingPlan), missingPlanSnapshot);
    assert.equal(missingRecommendation.action, "create_sidecar");
    assert.equal(missingRecommendation.reason, "sidecar_missing");
    assert.equal(missingRecommendation.sidecarPath, missingPlan.sidecarPath);
    assert.equal(missingRecommendation.sourcePath, missingPlan.sourcePath);
    assert.deepEqual(missingRecommendation.warnings, []);
    assert.ok(missingRecommendation.draft);
    assert.equal(missingRecommendation.patch, undefined);
    assert.equal(missingRecommendation.draft?.assetId, "asset-notes-draft.txt");
    assert.equal(missingRecommendation.draft?.schemaVersion, 1);
    assert.equal(missingRecommendation.draft?.sourcePath, "notes/draft.txt");
    assert.equal(missingRecommendation.draft?.canonicalPath, "notes/draft.txt");
    assert.equal(missingRecommendation.draft?.sha256, missingPlan.sourceFacts.sha256);
    assert.equal(missingRecommendation.draft?.sizeBytes, 13);
    assert.equal(missingRecommendation.draft?.createdAt, "2026-06-23T01:02:03.000Z");
    assert.equal(missingRecommendation.draft?.updatedAt, "2026-06-23T01:02:03.000Z");
    assert.equal(missingRecommendation.draft?.kind, "other");
    assert.deepEqual(missingRecommendation.draft?.tags, []);
    assert.deepEqual(missingRecommendation.draft?.derivedFiles, []);
    assert.equal(missingRecommendation.draft?.analysisStatus, "pending");
    assert.equal(missingRecommendation.draft?.approvalState, "unreviewed");
    assert.deepEqual(missingRecommendation.draft?.notes, []);

    const staleSidecar = createInitialSidecar({
      assetId: "asset-notes-stale.txt",
      sourcePath: "notes/stale.txt",
      canonicalPath: "notes/stale.txt",
      kind: "note",
      sha256: "old-hash",
      sizeBytes: 1,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: ["draft"],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    const stalePlan = {
      sourcePath: "notes/stale.txt",
      sidecarPath: "notes/stale.txt.prism.json",
      sourceStatus: "present" as const,
      sidecarStatus: "stale" as const,
      sourceFacts: {
        sizeBytes: 10,
        sha256: createHash("sha256").update("fresh content").digest("hex"),
      },
      sidecar: staleSidecar,
      reasons: ["sha256_mismatch", "sizeBytes_mismatch"],
      recommendedAction: "update_sidecar_hash" as const,
    };
    const stalePlanSnapshot = JSON.stringify(stalePlan);
    const staleRecommendation = recommendSidecarAction(stalePlan, { now: fixedNow });
    assert.equal(JSON.stringify(stalePlan), stalePlanSnapshot);
    assert.equal(staleRecommendation.action, "update_sidecar_hash");
    assert.equal(staleRecommendation.reason, "sidecar_stale");
    assert.equal(staleRecommendation.patch && Object.keys(staleRecommendation.patch).sort().join(","), "sha256,sizeBytes,updatedAt");
    assert.equal(staleRecommendation.patch?.sha256, stalePlan.sourceFacts.sha256);
    assert.equal(staleRecommendation.patch?.sizeBytes, 10);
    assert.equal(staleRecommendation.patch?.updatedAt, "2026-06-23T01:02:03.000Z");
    assert.equal(staleRecommendation.draft, undefined);

    const readyPlan = {
      sourcePath: "notes/ready.txt",
      sidecarPath: "notes/ready.txt.prism.json",
      sourceStatus: "present" as const,
      sidecarStatus: "valid" as const,
      sourceFacts: {
        sizeBytes: 9,
        sha256: createHash("sha256").update("ready content").digest("hex"),
      },
      sidecar: createInitialSidecar({
        assetId: "asset-notes-ready.txt",
        sourcePath: "notes/ready.txt",
        canonicalPath: "notes/ready.txt",
        kind: "note",
        sha256: createHash("sha256").update("ready content").digest("hex"),
        sizeBytes: 9,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
        tags: [],
        derivedFiles: [],
        analysisStatus: "pending",
        approvalState: "unreviewed",
        notes: [],
      }),
      reasons: [],
      recommendedAction: "ready" as const,
    };
    const readyRecommendation = recommendSidecarAction(readyPlan, { now: fixedNow });
    assert.equal(readyRecommendation.action, "ready");
    assert.equal(readyRecommendation.reason, "sidecar_ready");
    assert.equal(readyRecommendation.draft, undefined);
    assert.equal(readyRecommendation.patch, undefined);
    assert.deepEqual(readyRecommendation.warnings, []);

    const malformedPlan = {
      sourcePath: "notes/broken.txt",
      sidecarPath: "notes/broken.txt.prism.json",
      sourceStatus: "present" as const,
      sidecarStatus: "malformed" as const,
      sourceFacts: {
        sizeBytes: 4,
        sha256: createHash("sha256").update("oops").digest("hex"),
      },
      sidecar: null,
      reasons: ["sidecar_json_malformed"],
      recommendedAction: "review_sidecar" as const,
    };
    const malformedRecommendation = recommendSidecarAction(malformedPlan, { now: fixedNow });
    assert.equal(malformedRecommendation.action, "review_sidecar");
    assert.equal(malformedRecommendation.reason, "sidecar_malformed");
    assert.ok(malformedRecommendation.warnings.some((warning) => warning.includes("parse") || warning.includes("validated")));
    assert.equal(malformedRecommendation.draft, undefined);
    assert.equal(malformedRecommendation.patch, undefined);

    const mismatchedPlan = {
      sourcePath: "notes/mismatch.txt",
      sidecarPath: "notes/mismatch.txt.prism.json",
      sourceStatus: "present" as const,
      sidecarStatus: "mismatched_source" as const,
      sourceFacts: {
        sizeBytes: 5,
        sha256: createHash("sha256").update("mismatch").digest("hex"),
      },
      sidecar: createInitialSidecar({
        assetId: "asset-notes-other.txt",
        sourcePath: "notes/other.txt",
        canonicalPath: "notes/other.txt",
        kind: "note",
        sha256: "abc",
        sizeBytes: 3,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
        tags: [],
        derivedFiles: [],
        analysisStatus: "pending",
        approvalState: "unreviewed",
        notes: [],
      }),
      reasons: ["source_path_mismatch"],
      recommendedAction: "review_sidecar" as const,
    };
    const mismatchedRecommendation = recommendSidecarAction(mismatchedPlan, { now: fixedNow });
    assert.equal(mismatchedRecommendation.action, "review_sidecar");
    assert.equal(mismatchedRecommendation.reason, "source_path_mismatch");
    assert.ok(mismatchedRecommendation.warnings.some((warning) => warning.includes("does not match")));
    assert.equal(mismatchedRecommendation.draft, undefined);
    assert.equal(mismatchedRecommendation.patch, undefined);

    const missingSourcePlan = {
      sourcePath: "notes/missing.txt",
      sidecarPath: "notes/missing.txt.prism.json",
      sourceStatus: "missing" as const,
      sidecarStatus: "blocked" as const,
      sourceFacts: null,
      sidecar: null,
      reasons: ["source_missing"],
      recommendedAction: "blocked" as const,
    };
    const missingSourceRecommendation = recommendSidecarAction(missingSourcePlan, { now: fixedNow });
    assert.equal(missingSourceRecommendation.action, "blocked");
    assert.equal(missingSourceRecommendation.reason, "source_missing");
    assert.equal(missingSourceRecommendation.draft, undefined);
    assert.equal(missingSourceRecommendation.patch, undefined);

    const blockedPlan = {
      sourcePath: "notes/blocked.txt",
      sidecarPath: "notes/blocked.txt.prism.json",
      sourceStatus: "blocked" as const,
      sidecarStatus: "blocked" as const,
      sourceFacts: null,
      sidecar: null,
      reasons: ["path_outside_allowed_roots"],
      recommendedAction: "blocked" as const,
    };
    const blockedRecommendation = recommendSidecarAction(blockedPlan, { now: fixedNow });
    assert.equal(blockedRecommendation.action, "blocked");
    assert.equal(blockedRecommendation.reason, "source_blocked");
    assert.ok(blockedRecommendation.warnings.includes("path_outside_allowed_roots"));

    const unsupportedRecommendation = recommendSidecarAction({
      ...readyPlan,
      sidecarStatus: "unexpected" as never,
    } as typeof readyPlan, { now: fixedNow });
    assert.equal(unsupportedRecommendation.action, "blocked");
    assert.equal(unsupportedRecommendation.reason, "unsupported_plan_state");
  });

  await test("sidecar write plans are approval-gated and remain write-free", async () => {
    const fixedNow = () => "2026-06-23T01:02:03.000Z";
    const sourcePath = "notes/draft.txt";
    const sidecarPath = `${sourcePath}.prism.json`;
    const sha256 = createHash("sha256").update("draft content").digest("hex");

    const createRecommendation = recommendSidecarAction(
      {
        sourcePath,
        sidecarPath,
        sourceStatus: "present" as const,
        sidecarStatus: "missing" as const,
        sourceFacts: { sizeBytes: 13, sha256 },
        sidecar: null,
        reasons: ["sidecar_missing"],
        recommendedAction: "create_sidecar" as const,
      },
      { now: fixedNow },
    );
    const createRecommendationSnapshot = JSON.stringify(createRecommendation);
    const createPlan = planSidecarWrite(createRecommendation);
    const expectedCreateJson = {
      schemaVersion: 1,
      assetId: "asset-notes-draft.txt",
      sourcePath,
      canonicalPath: sourcePath,
      sha256,
      sizeBytes: 13,
      createdAt: "2026-06-23T01:02:03.000Z",
      updatedAt: "2026-06-23T01:02:03.000Z",
      kind: "other",
      tags: [],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    };
    assert.equal(JSON.stringify(createRecommendation), createRecommendationSnapshot);
    assert.equal(createPlan.status, "planned");
    assert.equal(createPlan.operation, "create_sidecar");
    assert.equal(createPlan.approvalType, "local_write");
    assert.equal(createPlan.sourcePath, sourcePath);
    assert.equal(createPlan.sidecarPath, sidecarPath);
    assert.equal(createPlan.content, `${JSON.stringify(expectedCreateJson, null, 2)}\n`);
    assert.deepEqual(createPlan.json, expectedCreateJson);
    assert.equal(createPlan.json?.sha256, sha256);
    assert.equal(createPlan.json?.schemaVersion, 1);
    assert.equal(createPlan.patch, undefined);
    assert.deepEqual(createPlan.reasons, ["sidecar_missing"]);
    assert.deepEqual(createPlan.warnings, []);
    assert.deepEqual(createPlan.safetyChecks, [
      "sidecar path must remain inside allowed roots",
      "parent/source relationship must be revalidated before write",
      "existing sidecar must not be overwritten without a later explicit approval mode",
    ]);

    const updateRecommendation = recommendSidecarAction(
      {
        sourcePath: "notes/stale.txt",
        sidecarPath: "notes/stale.txt.prism.json",
        sourceStatus: "present" as const,
        sidecarStatus: "stale" as const,
        sourceFacts: {
          sizeBytes: 10,
          sha256: createHash("sha256").update("fresh content").digest("hex"),
        },
        sidecar: createInitialSidecar({
          assetId: "asset-notes-stale.txt",
          sourcePath: "notes/stale.txt",
          canonicalPath: "notes/stale.txt",
          kind: "note",
          sha256: "old-hash",
          sizeBytes: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
          tags: ["draft"],
          derivedFiles: [],
          analysisStatus: "pending",
          approvalState: "unreviewed",
          notes: [],
        }),
        reasons: ["sha256_mismatch", "sizeBytes_mismatch"],
        recommendedAction: "update_sidecar_hash" as const,
      },
      { now: fixedNow },
    );
    const updateRecommendationSnapshot = JSON.stringify(updateRecommendation);
    const updatePlan = planSidecarWrite(updateRecommendation);
    assert.equal(JSON.stringify(updateRecommendation), updateRecommendationSnapshot);
    assert.equal(updatePlan.status, "planned");
    assert.equal(updatePlan.operation, "update_sidecar");
    assert.equal(updatePlan.approvalType, "local_write");
    assert.equal(updatePlan.sourcePath, "notes/stale.txt");
    assert.equal(updatePlan.sidecarPath, "notes/stale.txt.prism.json");
    assert.equal(updatePlan.content, undefined);
    assert.equal(updatePlan.json, undefined);
    assert.deepEqual(updatePlan.patch, {
      sha256: updateRecommendation.patch?.sha256,
      sizeBytes: 10,
      updatedAt: "2026-06-23T01:02:03.000Z",
    });
    assert.deepEqual(updatePlan.reasons, ["sidecar_stale"]);
    assert.deepEqual(updatePlan.warnings, []);
    assert.deepEqual(updatePlan.safetyChecks, [
      "sidecar path must remain inside allowed roots",
      "sidecar must be re-read before write",
      "current sidecar sourcePath must still match requested sourcePath",
      "stale fields must be revalidated before write",
    ]);

    const readyPlan = planSidecarWrite({
      action: "ready",
      reason: "sidecar_ready",
      sidecarPath,
      sourcePath,
      warnings: [],
    });
    assert.equal(readyPlan.status, "not_applicable");
    assert.equal(readyPlan.operation, "none");
    assert.equal(readyPlan.approvalType, "none");
    assert.equal(readyPlan.content, undefined);
    assert.equal(readyPlan.patch, undefined);

    const reviewPlan = planSidecarWrite({
      action: "review_sidecar",
      reason: "source_path_mismatch",
      sidecarPath,
      sourcePath,
      warnings: ["sidecar sourcePath does not match the requested source path"],
    });
    assert.equal(reviewPlan.status, "blocked");
    assert.equal(reviewPlan.operation, "none");
    assert.equal(reviewPlan.approvalType, "none");
    assert.equal(reviewPlan.content, undefined);
    assert.equal(reviewPlan.patch, undefined);
    assert.deepEqual(reviewPlan.reasons, ["source_path_mismatch"]);
    assert.deepEqual(reviewPlan.warnings, ["sidecar sourcePath does not match the requested source path"]);

    const blockedPlan = planSidecarWrite({
      action: "blocked",
      reason: "source_missing",
      sidecarPath,
      sourcePath,
      warnings: ["source file is missing; no sidecar draft can be recommended"],
    });
    assert.equal(blockedPlan.status, "blocked");
    assert.equal(blockedPlan.operation, "none");
    assert.equal(blockedPlan.approvalType, "none");
    assert.equal(blockedPlan.content, undefined);
    assert.equal(blockedPlan.patch, undefined);

    const unknownPlan = planSidecarWrite({
      ...readyPlan,
      action: "unexpected" as never,
    } as never);
    assert.equal(unknownPlan.status, "blocked");
    assert.equal(unknownPlan.operation, "none");
    assert.ok(unknownPlan.warnings.some((warning) => warning.includes("unsupported recommendation action")));
  });

  await test("sidecar write executor writes approved create plans and blocks missing approval", async () => {
    const fixedNow = () => "2026-06-23T01:02:03.000Z";
    const fsRoot = path.join(ROOT, "sidecar-executor-create");
    fs.rmSync(fsRoot, { recursive: true, force: true });
    fs.mkdirSync(fsRoot, { recursive: true });
    fs.mkdirSync(path.join(fsRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(fsRoot, "notes", "draft.txt"), "draft content");

    const adapter = createFilesystemAdapter({
      id: "filesystem-sidecar-executor-create",
      allowedRoots: [fsRoot],
      baseDir: fsRoot,
    });

    const sourcePath = "notes/draft.txt";
    const sidecarPath = `${sourcePath}.prism.json`;
    const recommendation = recommendSidecarAction(
      {
        sourcePath,
        sidecarPath,
        sourceStatus: "present" as const,
        sidecarStatus: "missing" as const,
        sourceFacts: {
          sizeBytes: Buffer.byteLength("draft content"),
          sha256: createHash("sha256").update("draft content").digest("hex"),
        },
        sidecar: null,
        reasons: ["sidecar_missing"],
        recommendedAction: "create_sidecar" as const,
      },
      { now: fixedNow },
    );
    const plan = planSidecarWrite(recommendation);
    const planSnapshot = JSON.stringify(plan);
    const planJsonSnapshot = JSON.stringify(plan.json);

    const blocked = await executeSidecarWritePlan({ plan, filesystem: adapter });
    assert.equal(JSON.stringify(plan), planSnapshot);
    assert.equal(JSON.stringify(plan.json), planJsonSnapshot);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.operation, "none");
    assert.equal(blocked.sourcePath, sourcePath);
    assert.equal(blocked.sidecarPath, sidecarPath);
    assert.deepEqual(blocked.reasons, ["local_write_approval_required"]);
    assert.equal(fs.existsSync(path.join(fsRoot, sidecarPath)), false);

    const written = await executeSidecarWritePlan({
      plan,
      filesystem: adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(JSON.stringify(plan), planSnapshot);
    assert.equal(JSON.stringify(plan.json), planJsonSnapshot);
    assert.equal(written.status, "written");
    assert.equal(written.operation, "create_sidecar");
    assert.equal(written.sourcePath, sourcePath);
    assert.equal(written.sidecarPath, sidecarPath);
    assert.deepEqual(written.reasons, ["sidecar_missing"]);
    assert.deepEqual(written.warnings, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fsRoot, sidecarPath), "utf-8")), plan.json);
    assert.equal(fs.readFileSync(path.join(fsRoot, "notes", "draft.txt"), "utf-8"), "draft content");

    const readyPlan = planSidecarWrite({
      action: "ready",
      reason: "sidecar_ready",
      sidecarPath,
      sourcePath,
      warnings: [],
    });
    const skipped = await executeSidecarWritePlan({
      plan: readyPlan,
      filesystem: adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.operation, "none");
    assert.equal(skipped.sourcePath, sourcePath);
    assert.equal(skipped.sidecarPath, sidecarPath);
    assert.deepEqual(skipped.reasons, ["sidecar_ready"]);
  });

  await test("sidecar write executor updates hash fields only after revalidation", async () => {
    const fixedNow = () => "2026-06-23T01:02:03.000Z";
    const fsRoot = path.join(ROOT, "sidecar-executor-update");
    fs.rmSync(fsRoot, { recursive: true, force: true });
    fs.mkdirSync(fsRoot, { recursive: true });
    fs.mkdirSync(path.join(fsRoot, "notes"), { recursive: true });

    const adapter = createFilesystemAdapter({
      id: "filesystem-sidecar-executor-update",
      allowedRoots: [fsRoot],
      baseDir: fsRoot,
    });

    const sourcePath = "notes/stale.txt";
    const sidecarPath = `${sourcePath}.prism.json`;
    const sourceContent = "fresh content";
    const sourceHash = createHash("sha256").update(sourceContent).digest("hex");
    fs.writeFileSync(path.join(fsRoot, sourcePath), sourceContent);

    const staleSidecar = createInitialSidecar({
      assetId: "asset-notes-stale.txt",
      sourcePath,
      canonicalPath: sourcePath,
      kind: "note",
      sha256: "old-hash",
      sizeBytes: 1,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: ["draft"],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    fs.writeFileSync(path.join(fsRoot, sidecarPath), `${JSON.stringify(staleSidecar, null, 2)}\n`);

    const recommendation = recommendSidecarAction(
      {
        sourcePath,
        sidecarPath,
        sourceStatus: "present" as const,
        sidecarStatus: "stale" as const,
        sourceFacts: {
          sizeBytes: Buffer.byteLength(sourceContent),
          sha256: sourceHash,
        },
        sidecar: staleSidecar,
        reasons: ["sha256_mismatch", "sizeBytes_mismatch"],
        recommendedAction: "update_sidecar_hash" as const,
      },
      { now: fixedNow },
    );
    const plan = planSidecarWrite(recommendation);
    const planSnapshot = JSON.stringify(plan);
    const patchSnapshot = JSON.stringify(plan.patch);

    const blocked = await executeSidecarWritePlan({ plan, filesystem: adapter });
    assert.equal(JSON.stringify(plan), planSnapshot);
    assert.equal(JSON.stringify(plan.patch), patchSnapshot);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.operation, "none");
    assert.deepEqual(blocked.reasons, ["local_write_approval_required"]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(fsRoot, sidecarPath), "utf-8")),
      staleSidecar,
    );

    const written = await executeSidecarWritePlan({
      plan,
      filesystem: adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(JSON.stringify(plan), planSnapshot);
    assert.equal(JSON.stringify(plan.patch), patchSnapshot);
    assert.equal(written.status, "written");
    assert.equal(written.operation, "update_sidecar");
    assert.equal(written.sourcePath, sourcePath);
    assert.equal(written.sidecarPath, sidecarPath);
    const updatedSidecar = JSON.parse(fs.readFileSync(path.join(fsRoot, sidecarPath), "utf-8"));
    assert.equal(updatedSidecar.schemaVersion, 1);
    assert.equal(updatedSidecar.sha256, sourceHash);
    assert.equal(updatedSidecar.sizeBytes, Buffer.byteLength(sourceContent));
    assert.equal(updatedSidecar.updatedAt, "2026-06-23T01:02:03.000Z");
    assert.equal(updatedSidecar.assetId, staleSidecar.assetId);
    assert.equal(updatedSidecar.sourcePath, staleSidecar.sourcePath);
    assert.deepEqual(updatedSidecar.tags, staleSidecar.tags);

    const mismatchSourcePath = "notes/mismatch.txt";
    const mismatchSidecarPath = `${mismatchSourcePath}.prism.json`;
    const mismatchContent = "mismatch content";
    const mismatchHash = createHash("sha256").update(mismatchContent).digest("hex");
    fs.writeFileSync(path.join(fsRoot, mismatchSourcePath), mismatchContent);
    const mismatchSidecar = createInitialSidecar({
      assetId: "asset-notes-mismatch.txt",
      sourcePath: mismatchSourcePath,
      canonicalPath: mismatchSourcePath,
      kind: "note",
      sha256: "old-hash",
      sizeBytes: 4,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: [],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    fs.writeFileSync(path.join(fsRoot, mismatchSidecarPath), `${JSON.stringify(mismatchSidecar, null, 2)}\n`);
    const mismatchRecommendation = recommendSidecarAction(
      {
        sourcePath: mismatchSourcePath,
        sidecarPath: mismatchSidecarPath,
        sourceStatus: "present" as const,
        sidecarStatus: "stale" as const,
        sourceFacts: {
          sizeBytes: Buffer.byteLength(mismatchContent),
          sha256: mismatchHash,
        },
        sidecar: mismatchSidecar,
        reasons: ["sha256_mismatch", "sizeBytes_mismatch"],
        recommendedAction: "update_sidecar_hash" as const,
      },
      { now: fixedNow },
    );
    const mismatchPlan = planSidecarWrite(mismatchRecommendation);
    const mismatchPlanSnapshot = JSON.stringify(mismatchPlan);
    const mismatchDriftedSidecar = { ...mismatchSidecar, sourcePath: "notes/other.txt", canonicalPath: "notes/other.txt" };
    fs.writeFileSync(path.join(fsRoot, mismatchSidecarPath), `${JSON.stringify(mismatchDriftedSidecar, null, 2)}\n`);
    const mismatchBefore = fs.readFileSync(path.join(fsRoot, mismatchSidecarPath), "utf-8");

    const mismatchResult = await executeSidecarWritePlan({
      plan: mismatchPlan,
      filesystem: adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(JSON.stringify(mismatchPlan), mismatchPlanSnapshot);
    assert.equal(mismatchResult.status, "blocked");
    assert.equal(mismatchResult.operation, "update_sidecar");
    assert.deepEqual(mismatchResult.reasons, ["source_path_mismatch"]);
    assert.equal(fs.readFileSync(path.join(fsRoot, mismatchSidecarPath), "utf-8"), mismatchBefore);
  });

  await test("sidecar write executor rejects forged plans outside allowed roots", async () => {
    const fsRoot = path.join(ROOT, "sidecar-executor-escape");
    fs.rmSync(fsRoot, { recursive: true, force: true });
    fs.mkdirSync(fsRoot, { recursive: true });

    const adapter = createFilesystemAdapter({
      id: "filesystem-sidecar-executor-escape",
      allowedRoots: [fsRoot],
      baseDir: fsRoot,
    });

    const sourcePath = path.join("..", "escape.txt");
    const sidecarPath = `${sourcePath}.prism.json`;
    const forgedJson = createInitialSidecar({
      assetId: "asset-escape",
      sourcePath,
      canonicalPath: sourcePath,
      kind: "note",
      sha256: "abc",
      sizeBytes: 3,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      tags: [],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    const forgedPlan: SidecarWritePlan = {
      status: "planned",
      operation: "create_sidecar",
      approvalType: "local_write",
      sourcePath,
      sidecarPath,
      content: `${JSON.stringify(forgedJson, null, 2)}\n`,
      json: forgedJson,
      reasons: ["sidecar_missing"],
      warnings: [],
      safetyChecks: [],
    };

    const result = await executeSidecarWritePlan({
      plan: forgedPlan,
      filesystem: adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.operation, "create_sidecar");
    assert.ok(result.reasons.some((reason) => reason === "path_traversal_blocked" || reason === "path_outside_allowed_roots"));
  });

  await test("local file sidecar command plans and executes one explicit file only", async () => {
    const fixedNow = () => "2026-06-23T01:02:03.000Z";
    assert.equal(typeof runLocalFileSidecarCommand, "function");
    assert.equal(typeof planSidecarWrite, "function");
    assert.equal(typeof executeSidecarWritePlan, "function");

    const planOnlyRoot = path.join(ROOT, "sidecar-command-plan-only");
    fs.rmSync(planOnlyRoot, { recursive: true, force: true });
    fs.mkdirSync(planOnlyRoot, { recursive: true });
    fs.mkdirSync(path.join(planOnlyRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(planOnlyRoot, "notes", "draft.txt"), "draft content");

    const tracedPlanOnly = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-command-plan-only",
        allowedRoots: [planOnlyRoot],
        baseDir: planOnlyRoot,
      }),
    );

    const planOnlyResult = await runLocalFileSidecarCommand({
      mode: "plan_only",
      sourcePath: "notes/draft.txt",
      filesystemAdapter: tracedPlanOnly.adapter,
    });
    const planOnlySnapshot = JSON.stringify({
      planner: planOnlyResult.planner,
      recommendation: planOnlyResult.recommendation,
      writePlan: planOnlyResult.writePlan,
    });
    assert.equal(planOnlyResult.mode, "plan_only");
    assert.equal(planOnlyResult.sourcePath, "notes/draft.txt");
    assert.equal(planOnlyResult.sidecarPath, "notes/draft.txt.prism.json");
    assert.equal(planOnlyResult.status, "planned");
    assert.equal(planOnlyResult.planner.sourceStatus, "present");
    assert.equal(planOnlyResult.planner.sidecarStatus, "missing");
    assert.equal(planOnlyResult.recommendation.action, "create_sidecar");
    assert.equal(planOnlyResult.writePlan.status, "planned");
    assert.equal(planOnlyResult.writePlan.operation, "create_sidecar");
    assert.equal(planOnlyResult.execution, undefined);
    assert.deepEqual(planOnlyResult.reasons, ["sidecar_missing"]);
    assert.deepEqual(planOnlyResult.warnings, []);
    assert.equal(fs.existsSync(path.join(planOnlyRoot, "notes", "draft.txt.prism.json")), false);
    assert.ok(!tracedPlanOnly.operations.includes("writeJsonFile"));
    assert.ok(!tracedPlanOnly.operations.includes("readJsonFile"));
    assert.equal(JSON.parse(JSON.stringify(planOnlyResult)).status, "planned");
    assert.equal(JSON.stringify({
      planner: planOnlyResult.planner,
      recommendation: planOnlyResult.recommendation,
      writePlan: planOnlyResult.writePlan,
    }), planOnlySnapshot);

    const executeMissingRoot = path.join(ROOT, "sidecar-command-execute-missing");
    fs.rmSync(executeMissingRoot, { recursive: true, force: true });
    fs.mkdirSync(executeMissingRoot, { recursive: true });
    fs.mkdirSync(path.join(executeMissingRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(executeMissingRoot, "notes", "draft.txt"), "draft content");

    const tracedExecuteMissing = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-command-execute-missing",
        allowedRoots: [executeMissingRoot],
        baseDir: executeMissingRoot,
      }),
    );

    const executeMissingNoApprovalRoot = path.join(ROOT, "sidecar-command-execute-missing-no-approval");
    fs.rmSync(executeMissingNoApprovalRoot, { recursive: true, force: true });
    fs.mkdirSync(executeMissingNoApprovalRoot, { recursive: true });
    fs.mkdirSync(path.join(executeMissingNoApprovalRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(executeMissingNoApprovalRoot, "notes", "draft.txt"), "draft content");

    const tracedExecuteMissingNoApproval = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-command-execute-missing-no-approval",
        allowedRoots: [executeMissingNoApprovalRoot],
        baseDir: executeMissingNoApprovalRoot,
      }),
    );

    const executeMissingNoApproval = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: "notes/draft.txt",
      filesystemAdapter: tracedExecuteMissingNoApproval.adapter,
    });
    assert.equal(executeMissingNoApproval.status, "blocked");
    assert.ok(executeMissingNoApproval.reasons.includes("local_write_approval_required"));
    assert.ok(!tracedExecuteMissingNoApproval.operations.includes("writeJsonFile"));
    assert.equal(fs.existsSync(path.join(executeMissingNoApprovalRoot, "notes", "draft.txt.prism.json")), false);
    assert.equal(JSON.parse(JSON.stringify(executeMissingNoApproval)).status, "blocked");

    const executeMissingResult = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: "notes/draft.txt",
      filesystemAdapter: tracedExecuteMissing.adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(executeMissingResult.status, "written");
    assert.equal(executeMissingResult.writePlan.status, "planned");
    assert.equal(executeMissingResult.execution?.status, "written");
    assert.equal(fs.existsSync(path.join(executeMissingRoot, "notes", "draft.txt.prism.json")), true);
    assert.ok(tracedExecuteMissing.operations.includes("writeJsonFile"));
    assert.ok(!tracedExecuteMissing.operations.includes("listDirectory"));
    assert.equal(JSON.parse(JSON.stringify(executeMissingResult)).status, "written");

    const readyRoot = path.join(ROOT, "sidecar-command-ready");
    fs.rmSync(readyRoot, { recursive: true, force: true });
    fs.mkdirSync(readyRoot, { recursive: true });
    fs.mkdirSync(path.join(readyRoot, "notes"), { recursive: true });
    const readySourcePath = "notes/ready.txt";
    const readyContent = "ready content";
    const readyHash = createHash("sha256").update(readyContent).digest("hex");
    const readySidecar = createInitialSidecar({
      assetId: "asset-notes-ready.txt",
      sourcePath: readySourcePath,
      canonicalPath: readySourcePath,
      kind: "note",
      sha256: readyHash,
      sizeBytes: Buffer.byteLength(readyContent),
      createdAt: fixedNow(),
      updatedAt: fixedNow(),
      tags: [],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    fs.writeFileSync(path.join(readyRoot, readySourcePath), readyContent);
    fs.writeFileSync(path.join(readyRoot, `${readySourcePath}.prism.json`), `${JSON.stringify(readySidecar, null, 2)}\n`);

    const tracedReady = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-command-ready",
        allowedRoots: [readyRoot],
        baseDir: readyRoot,
      }),
    );

    const readyPlanOnly = await runLocalFileSidecarCommand({
      mode: "plan_only",
      sourcePath: readySourcePath,
      filesystemAdapter: tracedReady.adapter,
    });
    assert.equal(readyPlanOnly.status, "skipped");
    assert.equal(readyPlanOnly.recommendation.action, "ready");
    assert.equal(readyPlanOnly.writePlan.status, "not_applicable");
    assert.equal(readyPlanOnly.execution, undefined);
    assert.equal(fs.readFileSync(path.join(readyRoot, `${readySourcePath}.prism.json`), "utf-8"), `${JSON.stringify(readySidecar, null, 2)}\n`);
    assert.ok(!tracedReady.operations.includes("writeJsonFile"));
    assert.equal(JSON.parse(JSON.stringify(readyPlanOnly)).status, "skipped");

    const readyExecute = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: readySourcePath,
      filesystemAdapter: tracedReady.adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(readyExecute.status, "skipped");
    assert.equal(readyExecute.writePlan.status, "not_applicable");
    assert.equal(readyExecute.execution, undefined);
    assert.ok(!tracedReady.operations.slice(-3).includes("writeJsonFile"));
    assert.equal(JSON.parse(JSON.stringify(readyExecute)).status, "skipped");

    const malformedRoot = path.join(ROOT, "sidecar-command-malformed");
    fs.rmSync(malformedRoot, { recursive: true, force: true });
    fs.mkdirSync(malformedRoot, { recursive: true });
    fs.mkdirSync(path.join(malformedRoot, "notes"), { recursive: true });
    const malformedSourcePath = "notes/broken.txt";
    fs.writeFileSync(path.join(malformedRoot, malformedSourcePath), "broken content");
    const malformedSidecarPath = `${malformedSourcePath}.prism.json`;
    fs.writeFileSync(path.join(malformedRoot, malformedSidecarPath), "{ not json");

    const tracedMalformed = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-command-malformed",
        allowedRoots: [malformedRoot],
        baseDir: malformedRoot,
      }),
    );

    const malformedPlanOnly = await runLocalFileSidecarCommand({
      mode: "plan_only",
      sourcePath: malformedSourcePath,
      filesystemAdapter: tracedMalformed.adapter,
    });
    assert.equal(malformedPlanOnly.status, "blocked");
    assert.equal(malformedPlanOnly.recommendation.action, "review_sidecar");
    assert.equal(malformedPlanOnly.writePlan.status, "blocked");
    assert.equal(malformedPlanOnly.execution, undefined);
    assert.equal(fs.readFileSync(path.join(malformedRoot, malformedSidecarPath), "utf-8"), "{ not json");
    assert.ok(!tracedMalformed.operations.includes("writeJsonFile"));
    assert.equal(JSON.parse(JSON.stringify(malformedPlanOnly)).status, "blocked");

    const malformedExecute = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: malformedSourcePath,
      filesystemAdapter: tracedMalformed.adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(malformedExecute.status, "blocked");
    assert.equal(malformedExecute.recommendation.action, "review_sidecar");
    assert.equal(malformedExecute.writePlan.status, "blocked");
    assert.equal(malformedExecute.execution, undefined);
    assert.equal(fs.readFileSync(path.join(malformedRoot, malformedSidecarPath), "utf-8"), "{ not json");
    assert.ok(!tracedMalformed.operations.includes("writeJsonFile"));
    assert.equal(JSON.parse(JSON.stringify(malformedExecute)).status, "blocked");

    const versionRoot = path.join(ROOT, "sidecar-command-version");
    fs.rmSync(versionRoot, { recursive: true, force: true });
    fs.mkdirSync(versionRoot, { recursive: true });
    fs.mkdirSync(path.join(versionRoot, "notes"), { recursive: true });
    const versionSourcePath = "notes/versioned.txt";
    fs.writeFileSync(path.join(versionRoot, versionSourcePath), "versioned content");
    const versionedSidecar = createInitialSidecar({
      assetId: "asset-notes-versioned.txt",
      sourcePath: versionSourcePath,
      canonicalPath: versionSourcePath,
      kind: "note",
      sha256: "old-hash",
      sizeBytes: 3,
      createdAt: fixedNow(),
      updatedAt: fixedNow(),
      tags: [],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    const unsupportedVersionSidecar = { ...versionedSidecar, schemaVersion: 999 };
    fs.writeFileSync(path.join(versionRoot, `${versionSourcePath}.prism.json`), `${JSON.stringify(unsupportedVersionSidecar, null, 2)}\n`);

    const tracedVersion = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-command-version",
        allowedRoots: [versionRoot],
        baseDir: versionRoot,
      }),
    );

    const versionPlanOnly = await runLocalFileSidecarCommand({
      mode: "plan_only",
      sourcePath: versionSourcePath,
      filesystemAdapter: tracedVersion.adapter,
    });
    assert.equal(versionPlanOnly.status, "blocked");
    assert.equal(versionPlanOnly.recommendation.action, "review_sidecar");
    assert.equal(versionPlanOnly.writePlan.status, "blocked");
    assert.equal(versionPlanOnly.execution, undefined);
    assert.equal(fs.readFileSync(path.join(versionRoot, `${versionSourcePath}.prism.json`), "utf-8"), `${JSON.stringify(unsupportedVersionSidecar, null, 2)}\n`);
    assert.ok(!tracedVersion.operations.includes("writeJsonFile"));

    const versionExecute = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: versionSourcePath,
      filesystemAdapter: tracedVersion.adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(versionExecute.status, "blocked");
    assert.equal(versionExecute.recommendation.action, "review_sidecar");
    assert.equal(versionExecute.writePlan.status, "blocked");
    assert.equal(versionExecute.execution, undefined);
    assert.equal(fs.readFileSync(path.join(versionRoot, `${versionSourcePath}.prism.json`), "utf-8"), `${JSON.stringify(unsupportedVersionSidecar, null, 2)}\n`);
    assert.ok(!tracedVersion.operations.includes("writeJsonFile"));

    const staleRoot = path.join(ROOT, "sidecar-command-stale");
    fs.rmSync(staleRoot, { recursive: true, force: true });
    fs.mkdirSync(staleRoot, { recursive: true });
    fs.mkdirSync(path.join(staleRoot, "notes"), { recursive: true });
    const staleSourcePath = "notes/stale.txt";
    const staleContent = "stale content";
    const staleHash = createHash("sha256").update(staleContent).digest("hex");
    fs.writeFileSync(path.join(staleRoot, staleSourcePath), staleContent);
    const staleSidecar = createInitialSidecar({
      assetId: "asset-notes-stale.txt",
      sourcePath: staleSourcePath,
      canonicalPath: staleSourcePath,
      kind: "note",
      sha256: "old-hash",
      sizeBytes: 1,
      createdAt: fixedNow(),
      updatedAt: fixedNow(),
      tags: ["draft"],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    fs.writeFileSync(path.join(staleRoot, `${staleSourcePath}.prism.json`), `${JSON.stringify(staleSidecar, null, 2)}\n`);

    const tracedStale = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-command-stale",
        allowedRoots: [staleRoot],
        baseDir: staleRoot,
      }),
    );

    const staleExecute = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: staleSourcePath,
      filesystemAdapter: tracedStale.adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(staleExecute.status, "written");
    assert.equal(staleExecute.writePlan.operation, "update_sidecar");
    assert.equal(staleExecute.execution?.status, "written");
    const staleWritten = JSON.parse(fs.readFileSync(path.join(staleRoot, `${staleSourcePath}.prism.json`), "utf-8"));
    assert.equal(staleWritten.schemaVersion, 1);
    assert.equal(staleWritten.sha256, staleHash);
    assert.equal(staleWritten.sizeBytes, Buffer.byteLength(staleContent));
    assert.equal(typeof staleWritten.updatedAt, "string");
    assert.ok(staleWritten.updatedAt.length > 0);
    assert.notEqual(staleWritten.updatedAt, staleSidecar.updatedAt);
    assert.equal(staleWritten.assetId, staleSidecar.assetId);
    assert.equal(staleWritten.sourcePath, staleSidecar.sourcePath);
    assert.equal(staleWritten.canonicalPath, staleSidecar.canonicalPath);

    const mismatchRoot = path.join(ROOT, "sidecar-command-mismatch");
    fs.rmSync(mismatchRoot, { recursive: true, force: true });
    fs.mkdirSync(mismatchRoot, { recursive: true });
    fs.mkdirSync(path.join(mismatchRoot, "notes"), { recursive: true });
    const mismatchSourcePath = "notes/mismatch.txt";
    const mismatchContent = "mismatch content";
    fs.writeFileSync(path.join(mismatchRoot, mismatchSourcePath), mismatchContent);
    const mismatchSidecar = createInitialSidecar({
      assetId: "asset-notes-other.txt",
      sourcePath: "notes/other.txt",
      canonicalPath: "notes/other.txt",
      kind: "note",
      sha256: "old-hash",
      sizeBytes: 4,
      createdAt: fixedNow(),
      updatedAt: fixedNow(),
      tags: [],
      derivedFiles: [],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: [],
    });
    fs.writeFileSync(path.join(mismatchRoot, `${mismatchSourcePath}.prism.json`), `${JSON.stringify(mismatchSidecar, null, 2)}\n`);

    const tracedMismatch = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-command-mismatch",
        allowedRoots: [mismatchRoot],
        baseDir: mismatchRoot,
      }),
    );

    const mismatchExecute = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: mismatchSourcePath,
      filesystemAdapter: tracedMismatch.adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(mismatchExecute.status, "blocked");
    assert.equal(mismatchExecute.recommendation.action, "review_sidecar");
    assert.equal(mismatchExecute.writePlan.status, "blocked");
    assert.equal(mismatchExecute.execution, undefined);
    assert.equal(fs.readFileSync(path.join(mismatchRoot, `${mismatchSourcePath}.prism.json`), "utf-8"), `${JSON.stringify(mismatchSidecar, null, 2)}\n`);

    const escapeExecute = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: path.join("..", "escape.txt"),
      filesystemAdapter: tracedMismatch.adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(escapeExecute.status, "blocked");
    assert.ok(escapeExecute.planner.reasons.some((reason) => reason === "path_traversal_blocked" || reason === "path_outside_allowed_roots"));
    assert.ok(!tracedMismatch.operations.includes("writeJsonFile"));
  });

  await test("public ingest examples stay explicit-file, write-free, and approval-gated", async () => {
    assert.equal(typeof buildSidecarPath, "function");
    assert.equal(typeof createInitialSidecar, "function");
    assert.equal(typeof planLocalFileRoundTrip, "function");
    assert.equal(typeof recommendSidecarAction, "function");
    assert.equal(typeof planSidecarWrite, "function");
    assert.equal(typeof executeSidecarWritePlan, "function");
    assert.equal(typeof runLocalFileSidecarCommand, "function");

    const planOnlyRoot = path.join(ROOT, "sidecar-examples-plan");
    fs.rmSync(planOnlyRoot, { recursive: true, force: true });
    fs.mkdirSync(planOnlyRoot, { recursive: true });
    fs.mkdirSync(path.join(planOnlyRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(planOnlyRoot, "notes", "example.txt"), "example content");

    const planOnlyAdapter = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-examples-plan",
        allowedRoots: [planOnlyRoot],
        baseDir: planOnlyRoot,
      }),
    );

    const planOnlyInput: LocalFileSidecarCommandInput = {
      mode: "plan_only",
      sourcePath: "notes/example.txt",
      filesystemAdapter: planOnlyAdapter.adapter,
    };
    const planOnlyResult = await runLocalFileSidecarCommand(planOnlyInput);
    const planOnlyPlanner: LocalFileRoundTripPlan = planOnlyResult.planner;
    const planOnlyRecommendation: SidecarRecommendation = planOnlyResult.recommendation;
    const planOnlyResultRoundTrip: LocalFileSidecarCommandResult = JSON.parse(JSON.stringify(planOnlyResult));
    void planOnlyPlanner;
    void planOnlyRecommendation;
    void planOnlyResultRoundTrip;
    assert.equal(planOnlyResult.status, "planned");
    assert.equal(planOnlyResult.execution, undefined);
    assert.equal(planOnlyResult.recommendation.action, "create_sidecar");
    assert.equal(JSON.stringify(planOnlyResult).length > 0, true);
    assert.ok(!planOnlyAdapter.operations.includes("writeJsonFile"));
    assert.ok(!planOnlyAdapter.operations.includes("writeTextFile"));

    const createRoot = path.join(ROOT, "sidecar-examples-create");
    fs.rmSync(createRoot, { recursive: true, force: true });
    fs.mkdirSync(createRoot, { recursive: true });
    fs.mkdirSync(path.join(createRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(createRoot, "notes", "example.txt"), "example content");

    const createAdapter = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-examples-create",
        allowedRoots: [createRoot],
        baseDir: createRoot,
      }),
    );

    const createResult = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: "notes/example.txt",
      filesystemAdapter: createAdapter.adapter,
      approval: { granted: true, approver: "tester" },
    });
    const createExecution: SidecarWriteExecutionResult | undefined = createResult.execution;
    const createRoundTrip: LocalFileSidecarCommandResult = JSON.parse(JSON.stringify(createResult));
    void createExecution;
    void createRoundTrip;
    assert.equal(createResult.status, "written");
    assert.equal(createResult.writePlan.operation, "create_sidecar");
    assert.equal(createResult.execution?.status, "written");
    assert.equal(fs.existsSync(path.join(createRoot, "notes", "example.txt.prism.json")), true);
    assert.ok(createAdapter.operations.includes("writeJsonFile"));
    assert.ok(!createAdapter.operations.includes("writeTextFile"));
    assert.ok(!createAdapter.operations.includes("unlink"));

    const blockedRoot = path.join(ROOT, "sidecar-examples-blocked");
    fs.rmSync(blockedRoot, { recursive: true, force: true });
    fs.mkdirSync(blockedRoot, { recursive: true });
    fs.mkdirSync(path.join(blockedRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(blockedRoot, "notes", "example.txt"), "example content");

    const blockedAdapter = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-examples-blocked",
        allowedRoots: [blockedRoot],
        baseDir: blockedRoot,
      }),
    );

    const blockedResult = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: "notes/example.txt",
      filesystemAdapter: blockedAdapter.adapter,
    });
    assert.equal(blockedResult.status, "blocked");
    assert.ok(blockedResult.reasons.includes("local_write_approval_required"));
    assert.equal(fs.existsSync(path.join(blockedRoot, "notes", "example.txt.prism.json")), false);
    assert.ok(!blockedAdapter.operations.includes("writeJsonFile"));

    const staleRoot = path.join(ROOT, "sidecar-examples-stale");
    fs.rmSync(staleRoot, { recursive: true, force: true });
    fs.mkdirSync(staleRoot, { recursive: true });
    fs.mkdirSync(path.join(staleRoot, "notes"), { recursive: true });
    const staleSourcePath = "notes/stale.txt";
    const staleContent = "stale content";
    const staleHash = createHash("sha256").update(staleContent).digest("hex");
    fs.writeFileSync(path.join(staleRoot, staleSourcePath), staleContent);
    const staleSidecar = createInitialSidecar({
      assetId: "asset-notes-stale.txt",
      sourcePath: staleSourcePath,
      canonicalPath: staleSourcePath,
      kind: "note",
      sha256: "old-hash",
      sizeBytes: 1,
      createdAt: "2026-06-23T01:02:03.000Z",
      updatedAt: "2026-06-23T01:02:03.000Z",
      tags: ["draft", "keep"],
      derivedFiles: ["notes/stale-preview.json"],
      analysisStatus: "pending",
      approvalState: "unreviewed",
      notes: ["preserve me"],
    });
    fs.writeFileSync(path.join(staleRoot, `${staleSourcePath}.prism.json`), `${JSON.stringify(staleSidecar, null, 2)}\n`);

    const staleAdapter = tracingFilesystemAdapter(
      createFilesystemAdapter({
        id: "filesystem-sidecar-examples-stale",
        allowedRoots: [staleRoot],
        baseDir: staleRoot,
      }),
    );

    const staleResult = await runLocalFileSidecarCommand({
      mode: "execute_approved",
      sourcePath: staleSourcePath,
      filesystemAdapter: staleAdapter.adapter,
      approval: { granted: true, approver: "tester" },
    });
    assert.equal(staleResult.status, "written");
    assert.equal(staleResult.writePlan.operation, "update_sidecar");
    assert.equal(staleResult.execution?.status, "written");
    const staleWritten = JSON.parse(fs.readFileSync(path.join(staleRoot, `${staleSourcePath}.prism.json`), "utf-8"));
    assert.equal(staleWritten.schemaVersion, 1);
    assert.equal(staleWritten.sha256, staleHash);
    assert.equal(staleWritten.sizeBytes, Buffer.byteLength(staleContent));
    assert.equal(staleWritten.assetId, staleSidecar.assetId);
    assert.equal(staleWritten.sourcePath, staleSidecar.sourcePath);
    assert.equal(staleWritten.canonicalPath, staleSidecar.canonicalPath);
    assert.deepEqual(staleWritten.tags, staleSidecar.tags);
    assert.deepEqual(staleWritten.derivedFiles, staleSidecar.derivedFiles);
    assert.equal(staleWritten.analysisStatus, staleSidecar.analysisStatus);
    assert.equal(staleWritten.approvalState, staleSidecar.approvalState);
    assert.deepEqual(staleWritten.notes, staleSidecar.notes);
    assert.ok(typeof staleWritten.updatedAt === "string" && staleWritten.updatedAt.length > 0);
    assert.equal(JSON.parse(JSON.stringify(staleResult)).status, "written");
    assert.ok(!staleAdapter.operations.includes("writeTextFile"));
    assert.ok(!staleAdapter.operations.includes("unlink"));
  });

  await test("real filesystem adapter stays inside allowed roots and returns deterministic metadata", async () => {
    const fsRoot = path.join(ROOT, "filesystem-real");
    fs.rmSync(fsRoot, { recursive: true, force: true });
    fs.mkdirSync(fsRoot, { recursive: true });
    fs.mkdirSync(path.join(fsRoot, "nested"), { recursive: true });
    fs.writeFileSync(path.join(fsRoot, "seed.txt"), "seed-value");
    fs.writeFileSync(path.join(fsRoot, "nested", "data.json"), JSON.stringify({ hello: "world" }) + "\n");

    const adapter = createFilesystemAdapter({
      id: "filesystem-real",
      name: "Real Filesystem Adapter",
      allowedRoots: [fsRoot],
      baseDir: fsRoot,
    });
    const registry = createAdapterRegistry();
    registry.registerAdapter(adapter);

    const health = await registry.checkAdapterHealth("filesystem-real");
    assert.equal(health.status, "healthy");
    assert.equal(registry.getAdapter("filesystem-real")?.id, "filesystem-real");

    const listResult = await adapter.execute(filesystemAction("fs1", "listDirectory", "listDirectory", "read_only", { path: "." }), {});
    assert.equal(listResult.success, true);
    assert.deepEqual(filesystemOutput(listResult, "listDirectory").entries.map((entry) => entry.name), ["nested", "seed.txt"]);
    assert.equal(listResult.metadata?.riskLevel, "read_only");

    const readResult = await adapter.execute(filesystemAction("fs2", "readTextFile", "readTextFile", "read_only", { path: "seed.txt" }), {});
    assert.equal(readResult.success, true);
    assert.equal(filesystemOutput(readResult, "readTextFile").content, "seed-value");
    assert.equal(readResult.metadata?.approvalRequired, "none");

    const writeResult = await adapter.execute(
      filesystemAction("fs3", "writeTextFile", "writeTextFile", "local_write", { path: "notes/written.txt", content: "local note" }),
      {},
    );
    assert.equal(writeResult.success, true);
    assert.equal(writeResult.metadata?.riskLevel, "local_write");
    assert.equal(writeResult.metadata?.approvalRequired, "recommended");
    assert.equal(filesystemOutput(writeResult, "writeTextFile").resolvedPath, path.join(fsRoot, "notes", "written.txt"));
    assert.equal(fs.readFileSync(path.join(fsRoot, "notes", "written.txt"), "utf-8"), "local note");

    const ensureResult = await adapter.execute(filesystemAction("fs4", "ensureDirectory", "ensureDirectory", "local_write", { path: "created/deeper" }), {});
    assert.equal(ensureResult.success, true);
    assert.equal(filesystemOutput(ensureResult, "ensureDirectory").created, true);
    assert.equal(fs.existsSync(path.join(fsRoot, "created", "deeper")), true);

    const statResult = await adapter.execute(filesystemAction("fs5", "statPath", "statPath", "read_only", { path: "seed.txt" }), {});
    assert.equal(statResult.success, true);
    assert.equal(filesystemOutput(statResult, "statPath").stat.isFile, true);

    const hashResult = await adapter.execute(filesystemAction("fs6", "computeSha256", "computeSha256", "read_only", { path: "seed.txt" }), {});
    assert.equal(hashResult.success, true);
    assert.equal(filesystemOutput(hashResult, "computeSha256").sha256, createHash("sha256").update("seed-value").digest("hex"));

    const sidecarResult = await adapter.execute(
      filesystemAction("fs7", "writeJsonSidecar", "writeJsonSidecar", "local_write", {
        path: "seed.txt",
        data: { note: "metadata", count: 2 },
      }),
      {},
    );
    assert.equal(sidecarResult.success, true);
    assert.equal(filesystemOutput(sidecarResult, "writeJsonSidecar").sidecarPath, path.join(fsRoot, "seed.txt.prism.json"));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(fsRoot, "seed.txt.prism.json"), "utf-8")),
      { note: "metadata", count: 2 },
    );

    const jsonRead = await adapter.execute(filesystemAction("fs8", "readJsonFile", "readJsonFile", "read_only", { path: "nested/data.json" }), {});
    assert.equal(jsonRead.success, true);
    assert.deepEqual(filesystemOutput(jsonRead, "readJsonFile").data, { hello: "world" });

    const jsonWrite = await adapter.execute(
      filesystemAction("fs9", "writeJsonFile", "writeJsonFile", "local_write", {
        path: "nested/output.json",
        data: { nested: true },
      }),
      {},
    );
    assert.equal(jsonWrite.success, true);
    assert.equal(filesystemOutput(jsonWrite, "writeJsonFile").resolvedPath, path.join(fsRoot, "nested", "output.json"));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fsRoot, "nested", "output.json"), "utf-8")), { nested: true });
  });

  await test("real filesystem adapter blocks boundary escapes, symlinks, and unsupported destructive operations", async () => {
    const fsRoot = path.join(ROOT, "filesystem-boundary");
    const escapeRoot = path.join(ROOT, "filesystem-escape");
    fs.rmSync(fsRoot, { recursive: true, force: true });
    fs.rmSync(escapeRoot, { recursive: true, force: true });
    fs.mkdirSync(fsRoot, { recursive: true });
    fs.mkdirSync(escapeRoot, { recursive: true });
    fs.writeFileSync(path.join(fsRoot, "allowed.txt"), "allowed");
    fs.writeFileSync(path.join(escapeRoot, "escape.txt"), "escape");
    fs.symlinkSync(path.join(escapeRoot, "escape.txt"), path.join(fsRoot, "linked.txt"));
    fs.symlinkSync(path.join(fsRoot, "allowed.txt"), path.join(fsRoot, "inner-linked.txt"));

    const adapter = createFilesystemAdapter({
      id: "filesystem-boundary",
      allowedRoots: [fsRoot],
      baseDir: fsRoot,
    });

    const blockedRead = await adapter.execute(filesystemAction("fb1", "readTextFile", "readTextFile", "read_only", { path: "../filesystem-escape/escape.txt" }), {});
    assert.equal(blockedRead.blocked, true);
    assert.equal(blockedRead.error?.code, "path_traversal_blocked");

    const blockedWrite = await adapter.execute(
      filesystemAction("fb2", "writeTextFile", "writeTextFile", "local_write", { path: "../filesystem-escape/escape.txt", content: "nope" }),
      {},
    );
    assert.equal(blockedWrite.blocked, true);
    assert.equal(blockedWrite.error?.code, "path_traversal_blocked");

    const blockedTraversal = await adapter.execute(
      filesystemAction("fb3", "readTextFile", "readTextFile", "read_only", { path: "nested/../../filesystem-escape/escape.txt" }),
      {},
    );
    assert.equal(blockedTraversal.blocked, true);
    assert.equal(blockedTraversal.error?.code, "path_traversal_blocked");

    const blockedSymlink = await adapter.execute(filesystemAction("fb4", "readTextFile", "readTextFile", "read_only", { path: "linked.txt" }), {});
    assert.equal(blockedSymlink.blocked, true);
    assert.equal(blockedSymlink.error?.code, "symlink_rejected");

    const blockedInnerSymlink = await adapter.execute(
      filesystemAction("fb4b", "readTextFile", "readTextFile", "read_only", { path: "inner-linked.txt" }),
      {},
    );
    assert.equal(blockedInnerSymlink.blocked, true);
    assert.equal(blockedInnerSymlink.error?.code, "symlink_rejected");

    const blockedParentEscape = await adapter.execute(
      filesystemAction("fb4c", "writeTextFile", "writeTextFile", "local_write", {
        path: path.join(fsRoot, "..", "filesystem-escape", "parent-escape.txt"),
        content: "nope",
      }),
      {},
    );
    assert.equal(blockedParentEscape.blocked, true);
    assert.equal(blockedParentEscape.error?.code, "path_outside_allowed_roots");

    const blockedSidecarEscape = await adapter.execute(
      filesystemAction("fb4d", "writeJsonSidecar", "writeJsonSidecar", "local_write", {
        path: "allowed.txt",
        data: { hello: "world" },
        sidecarSuffix: "../../escape.json",
      }),
      {},
    );
    assert.equal(blockedSidecarEscape.blocked, true);
    assert.equal(blockedSidecarEscape.error?.code, "path_traversal_blocked");

    const destructive = await adapter.execute(
      filesystemAction("fb5", "deletePath", "deletePath", "destructive", { path: "allowed.txt" }, "required"),
      { approval: { granted: true, approver: "tester" } },
    );
    assert.equal(destructive.blocked, true);
    assert.equal(destructive.error?.code, "unsupported_operation");
  });

  await test("sandbox harness resets and seeds only sandbox/tmp and exposes seeded files through the filesystem adapter", async () => {
    const fixtureTextPath = path.join(SANDBOX_FIXTURES_DIR, "attachments", "text-attachment.txt");
    const fixtureJsonPath = path.join(SANDBOX_FIXTURES_DIR, "metadata", "example.json");
    const fixtureTextBefore = fs.readFileSync(fixtureTextPath, "utf-8");
    const fixtureJsonBefore = fs.readFileSync(fixtureJsonPath, "utf-8");

    fs.rmSync(SANDBOX_TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(SANDBOX_TMP_DIR, "transient"), { recursive: true });
    fs.writeFileSync(path.join(SANDBOX_TMP_DIR, "transient", "volatile.txt"), "volatile");

    const resetResult = resetSandboxTmp();
    assert.equal(resetResult.tmpDir, SANDBOX_TMP_DIR);
    assert.equal(fs.existsSync(path.join(SANDBOX_TMP_DIR, "transient", "volatile.txt")), false);
    assert.equal(fs.existsSync(path.join(SANDBOX_TMP_DIR, ".gitkeep")), true);
    assert.equal(fs.readFileSync(fixtureTextPath, "utf-8"), fixtureTextBefore);
    assert.equal(fs.readFileSync(fixtureJsonPath, "utf-8"), fixtureJsonBefore);

    const seededResult = seedSandboxTmp();
    assert.equal(seededResult.tmpDir, SANDBOX_TMP_DIR);
    assert.equal(seededResult.sandboxDir, SANDBOX_DIR);
    assert.deepEqual(
      seededResult.seededFiles.map((filePath) => path.relative(SANDBOX_TMP_DIR, filePath)).sort(),
      [...getSandboxSeedRelativePaths()].sort(),
    );

    const adapter = createFilesystemAdapter({
      id: "sandbox-harness",
      allowedRoots: [SANDBOX_TMP_DIR],
      baseDir: SANDBOX_TMP_DIR,
    });

    const textResult = await adapter.execute(
      filesystemAction("sandbox1", "readTextFile", "readTextFile", "read_only", { path: "attachments/text-attachment.txt" }),
      {},
    );
    assert.equal(textResult.success, true);
    assert.equal(filesystemOutput(textResult, "readTextFile").content, fixtureTextBefore);

    const jsonResult = await adapter.execute(
      filesystemAction("sandbox2", "readJsonFile", "readJsonFile", "read_only", { path: "metadata/example.json" }),
      {},
    );
    assert.equal(jsonResult.success, true);
    assert.deepEqual(filesystemOutput(jsonResult, "readJsonFile").data, {
      kind: "sandbox-metadata",
      name: "example",
      version: 1,
      tags: ["local", "fixture", "deterministic"],
    });

    const listResult = await adapter.execute(filesystemAction("sandbox3", "listDirectory", "listDirectory", "read_only", { path: "." }), {});
    assert.equal(listResult.success, true);
    assert.ok(filesystemOutput(listResult, "listDirectory").entries.some((entry) => entry.name === "attachments"));
    assert.ok(filesystemOutput(listResult, "listDirectory").entries.some((entry) => entry.name === "metadata"));
    assert.ok(filesystemOutput(listResult, "listDirectory").entries.some((entry) => entry.name === "media"));

    const blockedTraversal = await adapter.execute(
      filesystemAction("sandbox4", "readTextFile", "readTextFile", "read_only", { path: "../fixtures/attachments/text-attachment.txt" }),
      {},
    );
    assert.equal(blockedTraversal.blocked, true);
    assert.equal(blockedTraversal.error?.code, "path_traversal_blocked");

    const blockedEscape = await adapter.execute(
      filesystemAction(
        "sandbox5",
        "readTextFile",
        "readTextFile",
        "read_only",
        { path: path.join(SANDBOX_FIXTURES_DIR, "attachments", "text-attachment.txt") },
      ),
      {},
    );
    assert.equal(blockedEscape.blocked, true);
    assert.equal(blockedEscape.error?.code, "path_outside_allowed_roots");

    assert.throws(() => resolveSandboxTmpPath("..", "escape.txt"), /must stay inside/i);
    assert.throws(() => assertInsideSandbox(path.join(SANDBOX_DIR, "..", "outside"), "sandbox escape check"), /must stay inside/i);
  });

  await test("adapter guard treats unknown high-risk operations as blocked until approved", async () => {
    const adapter = {
      id: "unknown-adapter",
      kind: "unknown" as const,
      mode: "mock" as const,
      approvalRequired: "required" as const,
    };
    assert.throws(() => {
      ensureApprovalAllowed(adapter, {}, action("a5", "push", "publish", "external_write"));
    }, /cannot execute/i);

    assert.throws(() => {
      ensureApprovalAllowed(adapter, { approval: { granted: true, approver: "tester" } }, action("a6", "push", "publish", "external_write"));
    }, /cannot execute/i);
  });

  await test("capability manifest seed data validates and stays within the scaffold boundary", async () => {
    assert.equal(seedCapabilityManifests.length, 8);
    for (const manifest of seedCapabilityManifests) {
      const result = validateCapabilityManifest(manifest);
      assert.equal(result.valid, true, `expected ${manifest.id} to validate: ${result.errors.join("; ")}`);
      assert.equal(result.errors.length, 0);
    }
  });

  await test("wavesurfer audio preview manifest stays lazy, local-only, and observe-only", async () => {
    const manifest = seedCapabilityManifests.find((item) => item.id === "wavesurfer.audio.preview");
    assert.ok(manifest);
    assert.equal(manifest?.runtime.loadMode, "lazy");
    assert.equal(manifest?.runtime.cpuProfile, "small");
    assert.equal(manifest?.runtime.memoryProfile, "medium");
    assert.equal(manifest?.runtime.supportsPreview, true);
    assert.equal(manifest?.runtime.supportsCancellation, true);
    assert.equal(manifest?.runtime.supportsProgress, false);
    assert.equal(manifest?.boundaries.localOnly, true);
    assert.equal(manifest?.boundaries.remoteOptional, false);
    assert.equal(manifest?.boundaries.remoteRequired, false);
    assert.equal(manifest?.boundaries.sendsUserDataOffMachine, false);
    assert.equal(manifest?.boundaries.modelDownloadRequired, false);
    assert.equal(manifest?.safety.approvalClass, "observe");
    assert.equal(manifest?.safety.checkpointPolicy, "none");
    assert.ok(manifest?.safety.riskNotes.some((note) => /memory/i.test(note)));
    assert.deepEqual(manifest?.io.inputTypes, ["audio-file"]);
    assert.deepEqual(manifest?.io.outputTypes, ["waveform-preview", "playback-state"]);
    assert.ok(manifest?.provenance.eventTypes.includes("attachment.audio.preview.opened"));
    assert.ok(manifest?.provenance.eventTypes.includes("attachment.audio.preview.ready"));
    assert.ok(manifest?.provenance.eventTypes.includes("attachment.audio.preview.closed"));
    assert.ok(manifest?.provenance.eventTypes.includes("attachment.audio.preview.failed"));
  });

  await test("capability manifest validation rejects empty ids", async () => {
    const manifest = structuredClone(seedCapabilityManifests[0]);
    manifest.id = "";
    const result = validateCapabilityManifest(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("id must be non-empty and stable-looking")));
  });

  await test("capability manifest validation rejects heavy/extreme capabilities in always mode", async () => {
    const manifest = structuredClone(seedCapabilityManifests[3]);
    manifest.runtime.cpuProfile = "heavy";
    manifest.runtime.memoryProfile = "heavy";
    manifest.runtime.loadMode = "always";
    const result = validateCapabilityManifest(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("heavy/extreme capabilities cannot use loadMode always")));
  });

  await test("capability manifest validation rejects remote-required manifests without remote approval", async () => {
    const manifest = structuredClone(seedCapabilityManifests[0]);
    manifest.boundaries.remoteRequired = true;
    manifest.safety.approvalClass = "observe";
    const result = validateCapabilityManifest(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("require approvalClass remote")));
  });

  await test("capability manifest validation rejects write manifests with checkpointPolicy none", async () => {
    const manifest = structuredClone(seedCapabilityManifests[0]);
    manifest.safety.approvalClass = "write";
    manifest.safety.checkpointPolicy = "none";
    const result = validateCapabilityManifest(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("checkpointPolicy none")));
  });

  await test("capability manifest validation rejects download-required manifests without model provenance", async () => {
    const manifest = structuredClone(seedCapabilityManifests[7]);
    manifest.provenance.storesModelInfo = false;
    const result = validateCapabilityManifest(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("must store model info in provenance")));
  });

  await test("capability manifest validation rejects avoid/reference_only manifests with commands", async () => {
    const manifest = structuredClone(seedCapabilityManifests[1]);
    manifest.runtime.loadMode = "avoid";
    const result = validateCapabilityManifest(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("avoid/reference_only capabilities cannot declare active CLI or API commands")));
  });

  await test("manifest registry rejects invalid manifests without mutating prior state", async () => {
    const registry = new ManifestCapabilityRegistry();
    const valid = structuredClone(seedCapabilityManifests[6]);
    const validResult = registry.registerCapabilityManifest(valid);
    assert.equal(validResult.registered, true);
    assert.equal(validResult.manifestId, valid.id);

    const before = registry.getCapabilityManifest(valid.id);
    assert.ok(before);

    const invalid = structuredClone(valid);
    invalid.title = "";
    invalid.safety.approvalClass = "write";
    invalid.safety.checkpointPolicy = "none";
    const invalidResult = registry.registerCapabilityManifest(invalid);
    assert.equal(invalidResult.registered, false);
    assert.equal(invalidResult.manifest, undefined);
    assert.ok(invalidResult.validation.errors.length > 0);

    const after = registry.getCapabilityManifest(valid.id);
    assert.deepEqual(after, before);
  });

  await test("manifest registry returns registered manifests by id", async () => {
    const registry = new ManifestCapabilityRegistry();
    const valid = structuredClone(seedCapabilityManifests[2]);
    const result = registry.registerCapabilityManifest(valid);
    assert.equal(result.registered, true);
    const fetched = registry.getCapabilityManifest(valid.id);
    assert.ok(fetched);
    assert.deepEqual(fetched, valid);
    const listed = registry.listCapabilityManifests();
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], valid);
  });

  await test("capability manifests serialize cleanly for UI use", async () => {
    const serialized = JSON.stringify(seedCapabilityManifests);
    const parsed = JSON.parse(serialized) as Array<{ id: string; title: string }>;
    assert.equal(parsed.length, seedCapabilityManifests.length);
    assert.equal(parsed[0].id, seedCapabilityManifests[0].id);
    assert.equal(parsed[0].title, seedCapabilityManifests[0].title);
  });

  await test("event ledger appends, filters, limits, and returns newest-first", async () => {
    const ledger = new InMemoryPrismEventLedger();
    const first = ledger.append({
      time: "2026-06-24T09:00:00.000Z",
      type: "system.notice",
      summary: "first event",
      severity: "info",
      source: "system",
      relatedCapabilityId: "cap.alpha",
    });
    const second = ledger.append({
      time: "2026-06-24T10:00:00.000Z",
      type: "job.failed",
      summary: "second event",
      severity: "high",
      source: "job",
      relatedArtifactId: "artifact-1",
    });
    const third = ledger.append({
      time: "2026-06-24T11:00:00.000Z",
      type: "approval.requested",
      summary: "third event",
      severity: "medium",
      source: "approval",
      relatedApprovalId: "approval-1",
      relatedCapabilityId: "cap.alpha",
    });

    assert.equal(ledger.get(second.id)?.summary, "second event");
    assert.deepEqual(ledger.list({ limit: 2 }).map((event) => event.id), [third.id, second.id]);
    assert.deepEqual(ledger.list({ type: "job.failed" }).map((event) => event.id), [second.id]);
    assert.deepEqual(ledger.list({ severity: "high" }).map((event) => event.id), [second.id]);
    assert.deepEqual(ledger.list({ relatedCapabilityId: "cap.alpha" }).map((event) => event.id), [third.id, first.id]);
    assert.deepEqual(ledger.list({ relatedArtifactId: "artifact-1" }).map((event) => event.id), [second.id]);
    ledger.clear();
    assert.equal(ledger.list().length, 0);
  });

  await test("approval queue requests, resolves, and emits ledger events without executing anything", async () => {
    const ledger = new InMemoryPrismEventLedger();
    const queue = new InMemoryApprovalQueue(ledger);
    const requested = queue.requestApproval({
      title: "Approve thumbnail write",
      summary: "Write derived thumbnail artifacts after preview.",
      approvalClass: "write",
      checkpointPolicy: "before_write",
      relatedCapabilityId: "sharp.image.thumbnail",
      relatedArtifactIds: ["artifact-123"],
      relatedFilePaths: ["images/photo.png"],
      previewAvailable: true,
      previewSummary: "Preview is available before write.",
      cliEquivalent: "prism approvals request --write",
      riskNotes: ["Derived thumbnails should remain reversible."],
      localRemoteBoundary: "local-only",
      requestedBy: "tester",
    });

    assert.equal(requested.status, "pending");
    assert.equal(queue.listApprovals().length, 1);
    assert.equal(queue.getApproval(requested.id)?.requestedBy, "tester");
    assert.equal(ledger.list({ type: "approval.requested" }).length, 1);

    const resolved = queue.resolveApproval(requested.id, {
      status: "approved",
      decidedAt: "2026-06-24T12:00:00.000Z",
      decidedBy: "reviewer",
      reason: "Looks safe.",
    });

    assert.equal(resolved.status, "approved");
    assert.equal(queue.getApproval(requested.id)?.status, "approved");
    assert.equal(queue.getApproval(requested.id)?.decision?.reason, "Looks safe.");
    assert.equal(ledger.list({ type: "approval.resolved" }).length, 1);
    assert.equal(ledger.list({ relatedApprovalId: requested.id }).length, 1);
  });

  await test("workbench data spine reflects queue and event ledger state", async () => {
    const db = freshMemoryDB("workbench-spine");
    db.db.prepare("INSERT INTO checkpoints (project_id, graph_id, node_id, sha, had_changes) VALUES (?, ?, ?, ?, ?)").run(
      "prism-spectra",
      "graph-1",
      "node-1",
      "sha-123",
      1,
    );
    db.db.prepare("INSERT INTO conversations (title, metadata) VALUES (?, ?)").run("Workbench chat", null);

    const ledger = new InMemoryPrismEventLedger();
    const queue = new InMemoryApprovalQueue(ledger);
    const requested = queue.requestApproval({
      title: "Review attachment ingest",
      summary: "Approve future attachment ingest preview support.",
      approvalClass: "preview",
      checkpointPolicy: "before_preview",
      relatedCapabilityId: "uppy.attachment.ingest",
      relatedArtifactIds: ["attachment-1"],
      relatedFilePaths: ["attachments/example.txt"],
      previewAvailable: true,
      previewSummary: "Preview can be rendered safely.",
      cliEquivalent: "prism approvals request --preview",
      riskNotes: ["Keep the ingest preview read-only."],
      localRemoteBoundary: "local-only",
      requestedBy: "workbench",
    });
    ledger.append({
      time: "2099-01-01T00:00:00.000Z",
      type: "system.notice",
      summary: "Manual ledger note",
      severity: "info",
      source: "system",
    });

    const approvals = buildWorkbenchApprovals({ approvalQueue: queue });
    assert.equal(approvals.count, 1);
    assert.equal(approvals.pendingCount, 1);
    assert.equal(approvals.totalCount, 1);
    assert.equal(approvals.items[0].id, requested.id);

    const changes = buildWorkbenchChanges(db, { approvalQueue: queue, eventLedger: ledger });
    assert.ok(changes.ledgerCount >= 2);
    assert.ok(changes.derivedCount >= 2);
    assert.ok(changes.items.some((item) => item.sourceKind === "ledger"));
    assert.ok(changes.items.some((item) => item.sourceKind === "derived"));

    const resume = buildWorkbenchResume(db, {
      projectLabel: "prism-spectra",
      workDirLabel: ".demo/work",
      approvalQueue: queue,
      eventLedger: ledger,
    });
    assert.equal(resume.pendingApprovalsCount, 1);
    assert.equal(resume.recentEventCount, 2);
    assert.equal(resume.lastEventSummary, "Manual ledger note");
    assert.equal(resume.nextSafeAction, "Review pending approvals");
    db.close();
  });

  await test("workbench data spine empty states remain calm and valid", async () => {
    const db = freshMemoryDB("workbench-empty");
    const ledger = new InMemoryPrismEventLedger();
    const queue = new InMemoryApprovalQueue(ledger);

    const approvals = buildWorkbenchApprovals({ approvalQueue: queue });
    const changes = buildWorkbenchChanges(db, { approvalQueue: queue, eventLedger: ledger });
    const resume = buildWorkbenchResume(db, {
      projectLabel: "prism-spectra",
      workDirLabel: ".demo/work",
      approvalQueue: queue,
      eventLedger: ledger,
    });

    assert.equal(approvals.count, 0);
    assert.equal(approvals.items.length, 0);
    assert.equal(changes.count, 0);
    assert.equal(changes.items.length, 0);
    assert.equal(resume.pendingApprovalsCount, 0);
    assert.equal(resume.recentEventCount, 0);
    assert.equal(resume.lastEventSummary, "No events recorded yet.");
    assert.equal(resume.nextSafeAction, "No urgent action");
    db.close();
  });

  await test("workbench project memory projections surface conversations and attachments", async () => {
    const db = freshMemoryDB("workbench-memory");
    db.db.prepare(
      "INSERT INTO conversations (id, title, metadata, created_at) VALUES (?, ?, ?, ?)"
    ).run(
      7,
      "Project memory thread",
      JSON.stringify({
        summary: "A calm project-memory thread for the workbench.",
        relatedCheckpointId: 17,
        relatedArtifactId: "artifact-thread-7",
      }),
      "2026-06-24T09:00:00.000Z",
    );
    db.db.prepare(
      "INSERT INTO messages (id, conversation_id, role, provider, model, prompt, response, response_sha, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      41,
      7,
      "assistant",
      "ollama",
      "llama",
      "What changed?",
      "We added project-memory workbench surfaces.",
      "sha-message-41",
      JSON.stringify(["notes.md"]),
      "2026-06-24T09:05:00.000Z",
    );
    db.db.prepare(
      "INSERT INTO attachments (id, conversation_id, filename, path, content_type, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      81,
      7,
      "notes.md",
      "notes/notes.md",
      "text/markdown",
      42,
      "sha-attachment-81",
      "2026-06-24T09:10:00.000Z",
    );
    db.db.prepare("INSERT INTO attachment_tags (attachment_id, tag, created_at) VALUES (?, ?, ?)")
      .run(81, "reference", "2026-06-24T09:11:00.000Z");
    db.db.prepare("INSERT INTO attachment_audit (attachment_id, action, details, actor, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(81, "upload", JSON.stringify({ filename: "notes.md", size: 42 }), "daemon", "2026-06-24T09:12:00.000Z");
    const attachmentLedger = new InMemoryPrismEventLedger();
    const attachmentLedgerEvent = attachmentLedger.append({
      type: "attachment.metadata.updated",
      summary: "Attachment display name updated to project-notes.md",
      severity: "info",
      source: "attachment",
      relatedArtifactId: "attachment:81",
      metadata: { attachmentId: 81, displayName: "project-notes.md" },
    });

    const conversations = listWorkbenchConversations(db, 10);
    assert.equal(conversations.totalCount, 1);
    assert.equal(conversations.items[0].id, 7);
    assert.equal(conversations.items[0].messageCount, 1);
    assert.equal(conversations.items[0].attachmentCount, 1);
    assert.equal(conversations.items[0].relatedCheckpointId, 17);
    assert.equal(conversations.items[0].relatedArtifactId, "artifact-thread-7");

    const conversation = getWorkbenchConversation(db, 7);
    assert.ok(conversation);
    assert.equal(conversation?.messages.length, 1);
    assert.equal(conversation?.attachments.length, 1);
    assert.equal(conversation?.metadata?.relatedArtifactId, "artifact-thread-7");

    const attachments = listWorkbenchAttachments(db, 10, attachmentLedger);
    assert.equal(attachments.totalCount, 1);
    assert.equal(attachments.items[0].id, 81);
    assert.equal(attachments.items[0].displayName, "notes.md");
    assert.equal(attachments.items[0].originalName, "notes.md");
    assert.equal(attachments.items[0].sourceKind, "local");
    assert.equal(attachments.items[0].relatedConversationIds[0], 7);
    assert.equal(attachments.items[0].relatedCheckpointIds[0], 17);
    assert.equal(attachments.items[0].relatedEventIds[0], attachmentLedgerEvent.id);
    assert.equal(attachments.items[0].tags[0], "reference");
    assert.equal(attachments.items[0].metadataStatus.includes("local"), true);
    assert.equal(attachments.items[0].metadataStatus.includes("typed"), true);
    assert.equal(attachments.items[0].metadataStatus.includes("tagged"), true);
    assert.equal(attachments.items[0].metadata.sourceKind, "local");

    const attachment = getWorkbenchAttachment(db, 81, attachmentLedger);
    assert.ok(attachment);
    assert.equal(attachment?.relatedConversations[0].id, 7);
    assert.equal(attachment?.relatedMessages.length, 1);
    assert.equal(attachment?.auditTrail.length, 1);
    assert.equal(attachment?.repairAvailable, true);

    const resume = buildWorkbenchResume(db, {
      projectLabel: "prism-spectra",
      workDirLabel: ".demo/work",
      approvalQueue: new InMemoryApprovalQueue(new InMemoryPrismEventLedger()),
      eventLedger: new InMemoryPrismEventLedger(),
    });
    assert.equal(resume.recentConversationCount, 1);
    assert.equal(resume.recentAttachmentCount, 1);
    assert.equal(resume.latestConversationSummary, "A calm project-memory thread for the workbench.");
    assert.equal(resume.latestAttachmentSummary, "notes.md");
    assert.equal(resume.nextSafeAction, "Review recent project memory");

    const changes = buildWorkbenchChanges(db, {
      approvalQueue: new InMemoryApprovalQueue(new InMemoryPrismEventLedger()),
      eventLedger: new InMemoryPrismEventLedger(),
    });
    assert.ok(changes.derivedCount >= 3);
    assert.ok(changes.items.some((item) => item.type === "conversation.created"));
    assert.ok(changes.items.some((item) => item.type === "message.summary"));
    assert.ok(changes.items.some((item) => item.type === "attachment.summary"));
    db.close();
  });

  await test("attachment preview summaries stay conservative and metadata-driven", async () => {
    const imagePreview = deriveAttachmentPreviewSummary({
      displayName: "cover.png",
      originalName: "cover.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      sourcePath: "uploads/cover.png",
    });
    assert.equal(imagePreview.kind, "image");
    assert.equal(imagePreview.status, "available");
    assert.equal(imagePreview.safeToRenderInline, true);
    assert.equal(imagePreview.requiresExternalTool, false);
    assert.equal(imagePreview.requiresUserAction, false);
    assert.equal(imagePreview.capabilityId, "sharp.image.thumbnail");

    const textPreview = deriveAttachmentPreviewSummary({
      displayName: "notes.md",
      originalName: "notes.md",
      mimeType: "text/markdown",
      sizeBytes: 2048,
      sourcePath: "uploads/notes.md",
    });
    assert.equal(textPreview.kind, "text");
    assert.equal(textPreview.status, "unavailable");
    assert.equal(textPreview.safeToRenderInline, false);
    assert.equal(textPreview.reason?.includes("safe text preview route"), true);

    const audioPreview = deriveAttachmentPreviewSummary({
      displayName: "clip.mp3",
      originalName: "clip.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: 4096,
      sourcePath: "uploads/clip.mp3",
    });
    assert.equal(audioPreview.kind, "audio");
    assert.equal(audioPreview.status, "available");
    assert.equal(audioPreview.safeToRenderInline, true);
    assert.equal(audioPreview.requiresUserAction, true);
    assert.equal(audioPreview.capabilityId, "wavesurfer.audio.preview");
    assert.equal(audioPreview.riskNotes.some((note) => /memory/i.test(note)), false);

    const videoPreview = deriveAttachmentPreviewSummary({
      displayName: "clip.mp4",
      originalName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4096,
      sourcePath: "uploads/clip.mp4",
    });
    assert.equal(videoPreview.kind, "video");
    assert.equal(videoPreview.status, "available");
    assert.equal(videoPreview.capabilityId, "ffmpeg.video.clip");

    const pdfPreview = deriveAttachmentPreviewSummary({
      displayName: "guide.pdf",
      originalName: "guide.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4096,
      sourcePath: "uploads/guide.pdf",
    });
    assert.equal(pdfPreview.kind, "pdf");
    assert.equal(pdfPreview.status, "available");

    const unknownPreview = deriveAttachmentPreviewSummary({
      displayName: "archive.bin",
      originalName: "archive.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 1024,
      sourcePath: "uploads/archive.bin",
    });
    assert.equal(unknownPreview.kind, "binary");
    assert.equal(unknownPreview.status, "unsupported");
    assert.equal(unknownPreview.safeToRenderInline, false);
    assert.equal(unknownPreview.requiresUserAction, false);

    const largePreview = deriveAttachmentPreviewSummary({
      displayName: "bulk.pdf",
      originalName: "bulk.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8 * 1024 * 1024,
      sourcePath: "uploads/bulk.pdf",
    });
    assert.equal(largePreview.kind, "pdf");
    assert.equal(largePreview.status, "available");
    assert.ok(largePreview.riskNotes.some((note) => note.toLowerCase().includes("memory")));

    const missingMimePreview = deriveAttachmentPreviewSummary({
      displayName: "untitled",
      originalName: "untitled",
      mimeType: null,
      sizeBytes: null,
      sourcePath: "uploads/untitled",
    });
    assert.equal(missingMimePreview.kind, "unknown");
    assert.equal(missingMimePreview.status, "unsupported");
    assert.equal(missingMimePreview.safeToRenderInline, false);
  });

  await test("e2e: daemon execute-graph and rollback via API", async () => {
    // spawn the daemon in a temporary cwd so it uses an isolated .demo/work
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiforge-e2e-"));
    const daemonScript = path.join(__dirname, "..", "tools", "daemon.ts");
    const tsxLoader = path.join(__dirname, "..", "node_modules", "tsx", "dist", "loader.mjs");
    const port = 32000 + Math.floor(Math.random() * 2000);
    const token = "e2e-test-token-" + Date.now();

    const daemon = spawn(process.execPath, ["--import", pathToFileURL(tsxLoader).href, daemonScript], {
      cwd: tmp,
      env: { ...process.env, AI_FORGE_DAEMON_PORT: String(port), AI_FORGE_DAEMON_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    let stdoutBuf = "";
    daemon.stdout!.on("data", (c) => {
      const s = String(c);
      stdoutBuf += s;
      if (s.includes("AI-Forge POC daemon listening")) started = true;
    });
    daemon.stderr!.on("data", (c) => {
      stdoutBuf += String(c);
    });

    // wait for server start
    const startDeadline = Date.now() + 8000;
    while (!started && Date.now() < startDeadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!started) {
      if (stdoutBuf.includes("listen EPERM") || stdoutBuf.includes("operation not permitted")) {
        daemon.kill();
        console.log("  skip - daemon execute-graph and rollback via API (socket bind not permitted in this environment)");
        return;
      }
      daemon.kill();
      throw new Error("daemon did not start: " + stdoutBuf.slice(0, 2000));
    }

    const manifestResponse = await fetch(`http://127.0.0.1:${port}/api/v1/capabilities/manifests`);
    assert.equal(manifestResponse.ok, true);
    const manifestPayload = await manifestResponse.json();
    assert.ok(Array.isArray(manifestPayload.manifests));
    assert.equal(manifestPayload.manifests.length, seedCapabilityManifests.length);
    assert.equal(manifestPayload.manifests[0].id, seedCapabilityManifests[0].id);

    const workbenchResponse = await fetch(`http://127.0.0.1:${port}/workbench`);
    assert.equal(workbenchResponse.ok, true);
    const workbenchHtml = await workbenchResponse.text();
    assert.match(workbenchHtml, /Spectra Workbench/);
    assert.match(workbenchHtml, /Resume/);
    assert.match(workbenchHtml, /Capabilities/);
    assert.match(workbenchHtml, /Approvals/);
    assert.match(workbenchHtml, /Changes/);
    assert.match(workbenchHtml, /Settings/);
    assert.match(workbenchHtml, /Conversations/);
    assert.match(workbenchHtml, /Attachments/);
    assert.match(workbenchHtml, /Add local attachment/);
    assert.match(workbenchHtml, /Local-only boundary reminder/);
    assert.match(workbenchHtml, /Display name/);
    assert.match(workbenchHtml, /Add tag/);
    assert.match(workbenchHtml, /Search/);
    assert.match(workbenchHtml, /Load mode/);
    assert.match(workbenchHtml, /Reset filters/);
    assert.match(workbenchHtml, /Recent events/);
    assert.match(workbenchHtml, /Related conversation/);
    assert.match(workbenchHtml, /Preview/);
    assert.match(workbenchHtml, /Load waveform preview/);
    const attachmentsSectionStart = workbenchHtml.indexOf('<section class="view" data-section="attachments"');
    const attachmentsSectionEnd = workbenchHtml.indexOf('<section class="view" data-section="approvals"');
    const attachmentsSection = attachmentsSectionStart >= 0 && attachmentsSectionEnd > attachmentsSectionStart
      ? workbenchHtml.slice(attachmentsSectionStart, attachmentsSectionEnd)
      : workbenchHtml;
    assert.ok(!/Google Drive|Dropbox|Box|Companion|Webcam|Delete attachment|Move attachment|file:\/\//i.test(attachmentsSection));
    assert.ok(!/<(?:audio|video)[^>]*\bautoplay\b/i.test(attachmentsSection));
    assert.ok(!/<audio\b[^>]*controls/i.test(attachmentsSection));
    assert.ok(!/microphone|recording|export|ffmpeg|whisper|tone\.js|meyda|essentia/i.test(attachmentsSection));
    assert.ok(!/wavesurfer/i.test(attachmentsSection));

    const resumeResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/resume`);
    assert.equal(resumeResponse.ok, true);
    const resumePayload = await resumeResponse.json();
    assert.ok(resumePayload.resume);
    assert.equal(resumePayload.resume.daemonStatus, "healthy");
    assert.equal(resumePayload.resume.mode, "read-only");
    assert.equal(typeof resumePayload.resume.projectLabel, "string");
    assert.equal(typeof resumePayload.resume.workDirLabel, "string");
    assert.ok(Array.isArray(resumePayload.resume.recentCheckpoints));
    assert.ok(Array.isArray(resumePayload.resume.recentConversations));
    assert.ok(Array.isArray(resumePayload.resume.recentAttachments));
    assert.equal(resumePayload.resume.pendingApprovalsCount, 0);
    assert.equal(resumePayload.resume.recentEventCount, 0);
    assert.equal(resumePayload.resume.lastEventSummary, "No events recorded yet.");

    const createConversationResponse = await fetch(`http://127.0.0.1:${port}/api/v1/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-local-token": token },
      body: JSON.stringify({
        title: "Workbench memory thread",
        metadata: {
          summary: "A calm project-memory conversation.",
          relatedCheckpointId: 17,
          relatedArtifactId: "artifact-thread-7",
        },
      }),
    });
    assert.equal(createConversationResponse.ok, true);
    const createConversationPayload = await createConversationResponse.json();
    const conversationId = Number(createConversationPayload.id);
    assert.ok(Number.isFinite(conversationId));

    const messageResponse = await fetch(`http://127.0.0.1:${port}/api/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-local-token": token },
      body: JSON.stringify({
        role: "assistant",
        provider: "ollama",
        model: "llama",
        prompt: "What changed?",
        response: "We added project-memory workbench surfaces.",
        attachments: ["notes.md"],
      }),
    });
    assert.equal(messageResponse.ok, true);

    const uploadResponse = await fetch(`http://127.0.0.1:${port}/api/v1/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-local-token": token },
      body: JSON.stringify({
        filename: "notes.md",
        contentType: "text/markdown",
        contentBase64: Buffer.from("workbench memory notes").toString("base64"),
        conversationId,
      }),
    });
    assert.equal(uploadResponse.ok, true);
    const uploadPayload = await uploadResponse.json();
    const attachmentId = uploadAttachmentId(uploadPayload, "legacy upload");

    const tagResponse = await fetch(`http://127.0.0.1:${port}/api/v1/attachments/${attachmentId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-local-token": token },
      body: JSON.stringify({ tag: "reference" }),
    });
    assert.equal(tagResponse.ok, true);

    const workbenchTagResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${attachmentId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "  project   memory  " }),
    });
    assert.equal(workbenchTagResponse.ok, true);
    const workbenchTagPayload = await workbenchTagResponse.json();
    assert.ok(Array.isArray(workbenchTagPayload.tags));
    assert.ok(workbenchTagPayload.tags.includes("project memory"));

    const duplicateTagResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${attachmentId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "project memory" }),
    });
    assert.equal(duplicateTagResponse.ok, true);
    const duplicateTagPayload = await duplicateTagResponse.json();
    assert.equal(duplicateTagPayload.tags.filter((tag: string) => tag === "project memory").length, 1);

    const emptyTagResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${attachmentId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "   " }),
    });
    assert.equal(emptyTagResponse.status, 400);

    const metadataUpdateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${attachmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "project-notes.md" }),
    });
    assert.equal(metadataUpdateResponse.ok, true);
    const metadataUpdatePayload = await metadataUpdateResponse.json();
    assert.equal(metadataUpdatePayload.attachment.displayName, "project-notes.md");
    assert.equal(metadataUpdatePayload.attachment.originalName, "notes.md");

    const emptyMetadataResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${attachmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "   " }),
    });
    assert.equal(emptyMetadataResponse.status, 400);

    const removeTagResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${attachmentId}/tags/project%20memory`, {
      method: "DELETE",
    });
    assert.equal(removeTagResponse.ok, true);

    const conversationsRouteResponse = await fetch(`http://127.0.0.1:${port}/api/v1/conversations`, {
      headers: { "x-local-token": token },
    });
    assert.equal(conversationsRouteResponse.ok, true);
    const conversationsRoutePayload = await conversationsRouteResponse.json();
    assert.ok(Array.isArray(conversationsRoutePayload.conversations));
    assert.ok(conversationsRoutePayload.conversations.some((row: any) => Number(row.id) === conversationId));

    const conversationMessagesResponse = await fetch(`http://127.0.0.1:${port}/api/v1/conversations/${conversationId}/messages`, {
      headers: { "x-local-token": token },
    });
    assert.equal(conversationMessagesResponse.ok, true);
    const conversationMessagesPayload = await conversationMessagesResponse.json();
    assert.equal(conversationMessagesPayload.messages.length, 1);

    const conversationAttachmentsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/conversations/${conversationId}/attachments`, {
      headers: { "x-local-token": token },
    });
    assert.equal(conversationAttachmentsResponse.ok, true);
    const conversationAttachmentsPayload = await conversationAttachmentsResponse.json();
    assert.equal(conversationAttachmentsPayload.attachments.length, 1);

    const attachmentsRouteResponse = await fetch(`http://127.0.0.1:${port}/api/v1/attachments`, {
      headers: { "x-local-token": token },
    });
    assert.equal(attachmentsRouteResponse.ok, true);
    const attachmentsRoutePayload = await attachmentsRouteResponse.json();
    assert.ok(Array.isArray(attachmentsRoutePayload.attachments));
    assert.ok(attachmentsRoutePayload.attachments.some((row: any) => Number(row.id) === attachmentId));

    const attachmentMetaResponse = await fetch(`http://127.0.0.1:${port}/api/v1/attachments/${attachmentId}/meta`, {
      headers: { "x-local-token": token },
    });
    assert.equal(attachmentMetaResponse.ok, true);
    const attachmentMetaPayload = await attachmentMetaResponse.json();
    assert.equal(Number(attachmentMetaPayload.attachment.id), attachmentId);

    const workbenchImportResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/import-local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "workbench-import.txt",
        contentType: "text/plain",
        contentBase64: Buffer.from("workbench local import").toString("base64"),
        conversationId,
      }),
    });
    assert.equal(workbenchImportResponse.ok, true);
    const workbenchImportPayload = await workbenchImportResponse.json();
    const workbenchImportId = Number(workbenchImportPayload.attachment.id);
    assert.ok(Number.isFinite(workbenchImportId));
    assert.equal(workbenchImportPayload.attachment.filename, "workbench-import.txt");

    const workbenchConversationsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/conversations`);
    assert.equal(workbenchConversationsResponse.ok, true);
    const workbenchConversationsPayload = await workbenchConversationsResponse.json();
    assert.ok(workbenchConversationsPayload.conversations);
    assert.ok(Array.isArray(workbenchConversationsPayload.conversations.items));
    assert.ok(workbenchConversationsPayload.conversations.items.some((row: any) => Number(row.id) === conversationId));

    const workbenchConversationDetailResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/conversations/${conversationId}`);
    assert.equal(workbenchConversationDetailResponse.ok, true);
    const workbenchConversationDetailPayload = await workbenchConversationDetailResponse.json();
    assert.equal(Number(workbenchConversationDetailPayload.conversation.id), conversationId);
    assert.equal(workbenchConversationDetailPayload.conversation.messages.length, 1);
    assert.equal(workbenchConversationDetailPayload.conversation.attachments.length, 1);

    const workbenchAttachmentsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments`);
    assert.equal(workbenchAttachmentsResponse.ok, true);
    const workbenchAttachmentsPayload = await workbenchAttachmentsResponse.json();
    assert.ok(Array.isArray(workbenchAttachmentsPayload.attachments));
    assert.ok(workbenchAttachmentsPayload.attachments.some((row: any) => Number(row.id) === attachmentId));
    assert.ok(workbenchAttachmentsPayload.attachments.some((row: any) => Number(row.id) === workbenchImportId));

    const workbenchAttachmentDetailResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${attachmentId}`);
    assert.equal(workbenchAttachmentDetailResponse.ok, true);
    const workbenchAttachmentDetailPayload = await workbenchAttachmentDetailResponse.json();
    assert.equal(Number(workbenchAttachmentDetailPayload.attachment.id), attachmentId);
    assert.equal(workbenchAttachmentDetailPayload.attachment.relatedConversations[0].id, conversationId);
    assert.equal(workbenchAttachmentDetailPayload.attachment.displayName, "project-notes.md");
    assert.equal(workbenchAttachmentDetailPayload.attachment.originalName, "notes.md");
    assert.ok(workbenchAttachmentDetailPayload.attachment.preview);
    assert.equal(workbenchAttachmentDetailPayload.attachment.preview.kind, "text");
    assert.equal(workbenchAttachmentDetailPayload.attachment.preview.status, "unavailable");
    assert.ok(Array.isArray(workbenchAttachmentDetailPayload.attachment.relatedEventIds));
    assert.ok(workbenchAttachmentDetailPayload.attachment.relatedEventIds.length >= 1);
    assert.ok(workbenchAttachmentDetailPayload.attachment.tags.includes("reference"));
    assert.equal(workbenchAttachmentDetailPayload.attachment.tags.includes("project memory"), false);

    const imageUploadResponse = await fetch(`http://127.0.0.1:${port}/api/v1/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-local-token": token },
      body: JSON.stringify({
        filename: "preview.png",
        contentType: "image/png",
        contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
        conversationId,
      }),
    });
    assert.equal(imageUploadResponse.ok, true);
    const imageUploadPayload = await imageUploadResponse.json();
    const imageAttachmentId = uploadAttachmentId(imageUploadPayload, "image upload");

    const imagePreviewResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${imageAttachmentId}/preview`);
    assert.equal(imagePreviewResponse.ok, true);
    assert.ok((imagePreviewResponse.headers.get("content-type") || "").includes("image/png"));
    assert.ok((imagePreviewResponse.headers.get("content-disposition") || "").includes("inline"));
    assert.equal(imagePreviewResponse.headers.get("access-control-allow-origin"), null);
    assert.ok((await imagePreviewResponse.arrayBuffer()).byteLength > 0);

    const imagePreviewPayloadResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${imageAttachmentId}`);
    assert.equal(imagePreviewPayloadResponse.ok, true);
    const imagePreviewPayload = await imagePreviewPayloadResponse.json();
    assert.equal(imagePreviewPayload.attachment.preview.kind, "image");
    assert.equal(imagePreviewPayload.attachment.preview.status, "available");
    assert.equal(imagePreviewPayload.attachment.preview.requiresUserAction, false);

    const audioUploadResponse = await fetch(`http://127.0.0.1:${port}/api/v1/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-local-token": token },
      body: JSON.stringify({
        filename: "preview.wav",
        contentType: "audio/wav",
        contentBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
        conversationId,
      }),
    });
    assert.equal(audioUploadResponse.ok, true);
    const audioUploadPayload = await audioUploadResponse.json();
    const audioAttachmentId = uploadAttachmentId(audioUploadPayload, "audio upload");

    const audioAttachmentDetailResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${audioAttachmentId}`);
    assert.equal(audioAttachmentDetailResponse.ok, true);
    const audioAttachmentDetailPayload = await audioAttachmentDetailResponse.json();
    assert.equal(audioAttachmentDetailPayload.attachment.preview.kind, "audio");
    assert.equal(audioAttachmentDetailPayload.attachment.preview.status, "available");
    assert.equal(audioAttachmentDetailPayload.attachment.preview.requiresUserAction, true);
    assert.equal(audioAttachmentDetailPayload.attachment.preview.capabilityId, "wavesurfer.audio.preview");
    assert.ok(audioAttachmentDetailPayload.attachment.preview.safeToRenderInline);
    assert.equal(audioAttachmentDetailPayload.attachment.preview.requiresExternalTool, false);

    const audioPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${audioAttachmentId}/preview`);
    assert.equal(audioPreviewResponse.ok, true);
    assert.ok((audioPreviewResponse.headers.get("content-type") || "").includes("audio/wav"));
    assert.ok((audioPreviewResponse.headers.get("content-disposition") || "").includes("inline"));
    assert.equal(audioPreviewResponse.headers.get("access-control-allow-origin"), null);
    assert.ok((await audioPreviewResponse.arrayBuffer()).byteLength > 0);

    const previewDb = new DatabaseSync(path.join(tmp, ".demo", "daemon.db"));
    const escapePath = path.join(tmp, "escape-preview.txt");
    fs.writeFileSync(escapePath, "escape preview");
    previewDb.prepare("UPDATE attachments SET path = ? WHERE id = ?").run(escapePath, imageAttachmentId);
    previewDb.close();

    const escapedPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${imageAttachmentId}/preview`);
    assert.equal(escapedPreviewResponse.status, 403);
    const escapedPreviewPayload = await escapedPreviewResponse.json();
    assert.match(String(escapedPreviewPayload.error || ""), /preview path is not allowed/i);

    const symlinkPath = path.join(tmp, "uploads", "audio-preview-link.wav");
    const symlinkTarget = path.join(tmp, "outside-audio-preview.wav");
    fs.writeFileSync(symlinkTarget, "outside preview");
    try {
      fs.symlinkSync(symlinkTarget, symlinkPath);
      const symlinkDb = new DatabaseSync(path.join(tmp, ".demo", "daemon.db"));
      try {
        symlinkDb.prepare("UPDATE attachments SET path = ? WHERE id = ?").run(symlinkPath, audioAttachmentId);
        const symlinkPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${audioAttachmentId}/preview`);
        assert.equal(symlinkPreviewResponse.status, 403);
        const symlinkPreviewPayload = await symlinkPreviewResponse.json();
        assert.match(String(symlinkPreviewPayload.error || ""), /preview path is not allowed/i);
      } finally {
        symlinkDb.close();
      }
    } catch (error) {
      if (!(error instanceof Error) || !/operation not permitted|EPERM/i.test(error.message)) {
        throw error;
      }
    }

    const unsupportedPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments/${attachmentId}/preview`);
    assert.equal(unsupportedPreviewResponse.status, 415);
    const unsupportedPreviewPayload = await unsupportedPreviewResponse.json();
    assert.match(String(unsupportedPreviewPayload.error || ""), /safe text preview route/i);

    const postWorkbenchConversationResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-local-token": token },
      body: JSON.stringify({ title: "not allowed" }),
    });
    assert.equal(postWorkbenchConversationResponse.status, 404);

    const postWorkbenchAttachmentResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-local-token": token },
      body: JSON.stringify({ title: "not allowed" }),
    });
    assert.equal(postWorkbenchAttachmentResponse.status, 404);

    const resumeAfterMemoryResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/resume`);
    assert.equal(resumeAfterMemoryResponse.ok, true);
    const resumeAfterMemoryPayload = await resumeAfterMemoryResponse.json();
    assert.equal(resumeAfterMemoryPayload.resume.recentConversationCount >= 1, true);
    assert.equal(resumeAfterMemoryPayload.resume.recentAttachmentCount >= 2, true);
    assert.equal(resumeAfterMemoryPayload.resume.latestAttachmentSummary, "project-notes.md");
    assert.equal(resumeAfterMemoryPayload.resume.nextSafeAction, "Review recent project memory");
    assert.match(resumeAfterMemoryPayload.resume.lastEventSummary, /local attachment/i);

    const approvalsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/approvals`);
    assert.equal(approvalsResponse.ok, true);
    const approvalsPayload = await approvalsResponse.json();
    assert.ok(approvalsPayload.approvals);
    assert.equal(approvalsPayload.approvals.count, 0);
    assert.equal(approvalsPayload.approvals.pendingCount, 0);
    assert.equal(approvalsPayload.approvals.totalCount, 0);
    assert.deepEqual(approvalsPayload.approvals.items, []);
    assert.ok(String(approvalsPayload.approvals.emptyStateMessage).length > 0);

    const changesResponse = await fetch(`http://127.0.0.1:${port}/api/v1/workbench/changes`);
    assert.equal(changesResponse.ok, true);
    const changesPayload = await changesResponse.json();
    assert.ok(changesPayload.changes);
    assert.equal(typeof changesPayload.changes.count, "number");
    assert.equal(typeof changesPayload.changes.ledgerCount, "number");
    assert.equal(typeof changesPayload.changes.derivedCount, "number");
    assert.ok(Array.isArray(changesPayload.changes.items));
    assert.equal(changesPayload.changes.count, changesPayload.changes.items.length);
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "conversation.created"));
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "message.summary"));
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "attachment.summary"));
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "attachment.ingest.completed"));
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "attachment.tag.added"));
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "attachment.tag.removed"));
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "attachment.metadata.updated"));
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "attachment.preview.requested"));
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "attachment.preview.available"));
    assert.ok(changesPayload.changes.items.some((item: any) => item.type === "attachment.preview.blocked"));
    assert.ok(String(changesPayload.changes.emptyStateMessage).length > 0);

    const eventsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/events`);
    assert.equal(eventsResponse.ok, true);
    const eventsPayload = await eventsResponse.json();
    assert.ok(Array.isArray(eventsPayload.events));
    assert.equal(eventsPayload.count, eventsPayload.events.length);
    assert.ok(eventsPayload.totalCount >= 4);
    assert.ok(eventsPayload.events.some((event: any) => event.type === "attachment.ingest.completed"));
    assert.ok(eventsPayload.events.some((event: any) => event.type === "attachment.tag.added"));
    assert.ok(eventsPayload.events.some((event: any) => event.type === "attachment.tag.removed"));
    assert.ok(eventsPayload.events.some((event: any) => event.type === "attachment.metadata.updated"));
    assert.ok(eventsPayload.events.some((event: any) => event.type === "attachment.preview.requested"));
    assert.ok(eventsPayload.events.some((event: any) => event.type === "attachment.preview.available"));
    assert.ok(eventsPayload.events.some((event: any) => event.type === "attachment.preview.blocked"));

    const approvalsRouteResponse = await fetch(`http://127.0.0.1:${port}/api/v1/approvals`);
    assert.equal(approvalsRouteResponse.ok, true);
    const approvalsRoutePayload = await approvalsRouteResponse.json();
    assert.ok(Array.isArray(approvalsRoutePayload.approvals));
    assert.equal(approvalsRoutePayload.count, approvalsRoutePayload.approvals.length);
    assert.equal(approvalsRoutePayload.pendingCount, 0);
    assert.equal(approvalsRoutePayload.totalCount, 0);

    // POST to execute-graph (streaming). Use a simple node that writes a file.
    const graph = { id: "g-e2e", projectId: "p-e2e", nodes: [{ id: "n1", packet: { intent: "create marker", node_type: "ui", context: { targetFile: "marker.txt" }, filePaths: ["marker.txt"], dependencies: [] } }] };
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/execute-graph`, { method: "POST", headers: { "Content-Type": "application/json", "x-local-token": token }, body: JSON.stringify({ graph, mode: "sequential" }) });
    if (!res.ok) {
      const bodyTxt = await res.text().catch(()=>'<no body>');
      daemon.kill();
      throw new Error(`execute-graph HTTP ${res.status}: ${bodyTxt}\nDaemon log:\n${stdoutBuf.slice(0,4000)}`);
    }

    // parse chunked JSON events separated by \n\n
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      buf += decoder.decode(r.value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const p of parts) {
        if (!p.trim()) continue;
        try { JSON.parse(p); } catch (e) {}
      }
    }

    // ensure file created in daemon's cwd .demo/work
    const created = path.join(tmp, ".demo", "work", "marker.txt");
    assert.ok(fs.existsSync(created), "expected marker file created by daemon execution");

    // confirm checkpoint persisted in daemon DB
    const dbFile = path.join(tmp, ".demo", "daemon.db");
    assert.ok(fs.existsSync(dbFile), "expected daemon DB file");
    const { MemoryDB } = await import("../src/memory/db.js");
    const mdb = new MemoryDB(dbFile);
    const rows = mdb.db.prepare('SELECT id, node_id, sha, had_changes, rolled_back FROM checkpoints ORDER BY created_at DESC').all();
    assert.ok(Array.isArray(rows) && rows.length > 0, "expected at least one checkpoint row");
    const cp = rows.find((r: any) => r.node_id === 'n1');
    assert.ok(cp, "expected checkpoint for node n1");

    // call rollback endpoint
    const rb = await fetch(`http://127.0.0.1:${port}/api/v1/nodes/n1/rollback`, { method: 'POST', headers: { 'x-local-token': token } });
    const rbj = await rb.json();
    if (!rb.ok || !rbj || !rbj.ok) {
      daemon.kill();
      throw new Error('rollback failed: ' + JSON.stringify(rbj));
    }

    // file should be reverted
    assert.equal(fs.existsSync(created), false, 'expected marker file to be reverted after rollback');

    try { mdb.close(); } catch (e) {}
    daemon.kill();
  });

  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log(`\n${passed} test(s) passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
