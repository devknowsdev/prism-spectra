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
  buildSidecarPath,
  buildSidecarPlan,
  createInitialSidecar,
  planLocalFileRoundTrip,
  updateSidecarHashFields,
  validateSidecarShape,
} from "../src/index.js";
import { dataBoundaryFor } from "../src/types.js";
import { Wizard, MAX_QUESTIONS } from "../src/wizard/wizard.js";
import { spawn } from "node:child_process";
import os from "node:os";
import type { TaskPacket } from "../src/types.js";

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
    assert.equal(validated.sidecar?.assetId, "asset-song-001");
    assert.equal(validated.sidecar?.canonicalPath, sourcePath);

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
