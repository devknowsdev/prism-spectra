process.env.AI_FORGE_MOCK_EXECUTORS = "1";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const DAEMON_SCRIPT = path.join(REPO_ROOT, "tools", "daemon.ts");
const TSX_LOADER = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs");

class TestSkip extends Error {}

async function waitForWorkbench(port: number, daemon: { exitCode: number | null }, output: () => string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (daemon.exitCode != null) throw new Error(`daemon exited before startup:\n${output()}`);
    if (/listen EPERM|operation not permitted/i.test(output())) {
      throw new TestSkip("socket bind is not permitted in this environment");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/workbench`);
      if (response.ok && (await response.text()).includes("Spectra Workbench")) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`daemon did not start:\n${output()}`);
}

async function startDaemon(cwd: string, port: number, token: string) {
  const daemon = spawn(process.execPath, ["--import", pathToFileURL(TSX_LOADER).href, DAEMON_SCRIPT], {
    cwd,
    env: {
      ...process.env,
      AI_FORGE_DAEMON_PORT: String(port),
      AI_FORGE_DAEMON_TOKEN: token,
      AI_FORGE_MOCK_EXECUTORS: "1",
      AI_FORGE_SHELL_MOUNT: "0",
      AI_FORGE_APP_PREVIEW: "0",
      AI_FORGE_WORKBENCH_WATCH: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  daemon.stdout.on("data", (chunk) => { log += String(chunk); });
  daemon.stderr.on("data", (chunk) => { log += String(chunk); });
  await waitForWorkbench(port, daemon, () => log);

  return {
    log: () => log,
    stop: async () => {
      if (daemon.exitCode != null) return;
      daemon.kill();
      await new Promise<void>((resolve) => {
        daemon.once("exit", () => resolve());
        setTimeout(resolve, 2_000);
      });
    },
  };
}

async function jsonRequest(
  port: number,
  token: string,
  pathname: string,
  init: RequestInit = {},
): Promise<{ response: Response; payload: any }> {
  const headers = new Headers(init.headers || {});
  headers.set("x-local-token", token);
  if (init.body != null) headers.set("Content-Type", "application/json");
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-f3b1-"));
  const port = 37200 + Math.floor(Math.random() * 1200);
  const token = `f3b1-${Date.now()}`;
  let daemon: Awaited<ReturnType<typeof startDaemon>> | null = null;

  try {
    daemon = await startDaemon(cwd, port, token);

    const createdA = await jsonRequest(port, token, "/api/v1/conversations", {
      method: "POST",
      body: JSON.stringify({ title: "Persistent A" }),
    });
    assert.equal(createdA.response.ok, true);
    const conversationA = Number(createdA.payload.id);
    assert.ok(Number.isSafeInteger(conversationA) && conversationA > 0);

    const createdB = await jsonRequest(port, token, "/api/v1/conversations", {
      method: "POST",
      body: JSON.stringify({ title: "Persistent B" }),
    });
    assert.equal(createdB.response.ok, true);
    const conversationB = Number(createdB.payload.id);
    assert.ok(Number.isSafeInteger(conversationB) && conversationB > 0);

    const ai = await jsonRequest(port, token, "/api/v1/ai/request", {
      method: "POST",
      body: JSON.stringify({
        sourceApp: "prism-spectra",
        intent: "workbench-chat",
        riskClass: "read-only",
        preferredMode: "local-only",
        record: false,
        input: { prompt: "Persist this local turn." },
      }),
    });
    assert.equal(ai.response.ok, true);
    assert.equal(ai.payload.ok, true);
    assert.equal(ai.payload.provider, "ollama");
    assert.equal(ai.payload.dataBoundary, "local");

    const stored = await jsonRequest(port, token, `/api/v1/conversations/${conversationA}/messages`, {
      method: "POST",
      body: JSON.stringify({
        role: "assistant",
        provider: ai.payload.provider,
        model: ai.payload.model,
        prompt: "Persist this local turn.",
        response: ai.payload.response,
      }),
    });
    assert.equal(stored.response.ok, true);
    assert.ok(Number(stored.payload.id) > 0);

    const beforeRestartA = await jsonRequest(port, token, `/api/v1/workbench/conversations/${conversationA}`);
    assert.equal(beforeRestartA.response.ok, true);
    assert.equal(beforeRestartA.payload.conversation.id, conversationA);
    assert.equal(beforeRestartA.payload.conversation.messages.length, 1);
    assert.equal(beforeRestartA.payload.conversation.messages[0].prompt, "Persist this local turn.");
    assert.equal(beforeRestartA.payload.conversation.messages[0].response, ai.payload.response);

    const beforeRestartB = await jsonRequest(port, token, `/api/v1/workbench/conversations/${conversationB}`);
    assert.equal(beforeRestartB.response.ok, true);
    assert.equal(beforeRestartB.payload.conversation.messages.length, 0, "conversation B must remain isolated");

    await daemon.stop();
    daemon = null;
    await new Promise((resolve) => setTimeout(resolve, 250));

    daemon = await startDaemon(cwd, port, token);
    const afterRestartA = await jsonRequest(port, token, `/api/v1/workbench/conversations/${conversationA}`);
    assert.equal(afterRestartA.response.ok, true);
    assert.equal(afterRestartA.payload.conversation.id, conversationA);
    assert.equal(afterRestartA.payload.conversation.title, "Persistent A");
    assert.equal(afterRestartA.payload.conversation.messages.length, 1);
    assert.equal(afterRestartA.payload.conversation.messages[0].prompt, "Persist this local turn.");
    assert.equal(afterRestartA.payload.conversation.messages[0].response, ai.payload.response);
    assert.equal(afterRestartA.payload.conversation.messages[0].provider, "ollama");

    const afterRestartB = await jsonRequest(port, token, `/api/v1/workbench/conversations/${conversationB}`);
    assert.equal(afterRestartB.response.ok, true);
    assert.equal(afterRestartB.payload.conversation.messages.length, 0, "conversation isolation must survive restart");

    console.log("workbench conversation persistence: passed");
  } finally {
    await daemon?.stop().catch(() => {});
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  if (error instanceof TestSkip) {
    console.log(`workbench conversation persistence: skipped: ${error.message}`);
    process.exitCode = 0;
    return;
  }
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
