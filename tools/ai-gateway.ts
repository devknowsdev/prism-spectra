#!/usr/bin/env -S tsx

import http from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ExecutionEngine, normalizeAiRequestBody } from "../src/index.js";
import { probeAllProviders, applyProviderProbe } from "../src/config/providerProbe.js";
import { createProjectCockpitRouter, renderProjectCockpitHtml } from "./cockpit/projectCockpit.js";

const PORT = Number(process.env.AI_FORGE_AI_GATEWAY_PORT ?? process.env.AI_FORGE_DAEMON_PORT ?? 3000);
const HOST = process.env.AI_FORGE_AI_GATEWAY_HOST ?? process.env.AI_FORGE_DAEMON_HOST ?? "127.0.0.1";
const ENV_TOKEN = process.env.AI_FORGE_AI_GATEWAY_TOKEN ?? process.env.AI_FORGE_DAEMON_TOKEN ?? process.env.LOCAL_AI_TOKEN;
const TOKEN = ENV_TOKEN || randomBytes(18).toString("hex");
const DB_PATH = process.env.AI_FORGE_AI_GATEWAY_DB ?? ".demo/ai-gateway.db";
const WORK_DIR = process.env.AI_FORGE_AI_GATEWAY_WORKDIR ?? path.join(".demo", "ai-gateway-work");
const MOCK_EXECUTORS = process.env.AI_FORGE_MOCK_EXECUTORS === "1";
const execFileAsync = promisify(execFile);

function jsonResponse(res: http.ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "x-local-token,content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(s);
}

function htmlResponse(res: http.ServerResponse, code: number, body: string) {
  res.writeHead(code, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function unauthorized(res: http.ServerResponse) {
  jsonResponse(res, 401, { error: "missing or invalid x-local-token header" });
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function start() {
  console.log(`[ai-gateway] mockExecutors: ${MOCK_EXECUTORS} (set AI_FORGE_MOCK_EXECUTORS=1 to enable mocks)`);

  const engine = new ExecutionEngine({
    dbPath: DB_PATH,
    workDir: WORK_DIR,
    mockExecutors: MOCK_EXECUTORS,
    fallbackOnFailure: false,
  });
  await engine.init();

  // Wire Ollama health check — same pattern as cli.ts
  const statuses = await probeAllProviders();
  applyProviderProbe(engine, statuses);
  const ollamaStatus = statuses.find(s => s.provider === "ollama");
  if (!ollamaStatus?.available) {
    console.warn("[ai-gateway] Ollama unavailable at startup — local tier disabled:", ollamaStatus?.reason ?? "no reason given");
  }

  const handleProjectCockpitRequest = createProjectCockpitRouter({
    host: HOST,
    port: PORT,
    token: TOKEN,
    mockExecutors: MOCK_EXECUTORS,
    dbPath: DB_PATH,
    workDir: WORK_DIR,
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "x-local-token,content-type",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        });
        return res.end();
      }

      if (req.method === "GET" && url.pathname === "/cockpit") {
        return htmlResponse(res, 200, renderProjectCockpitHtml());
      }

      const provided = req.headers["x-local-token"];
      if (provided !== TOKEN) return unauthorized(res);

      const cockpitHandled = await handleProjectCockpitRequest(req, res, url);
      if (cockpitHandled !== false) return;

      if (req.method === "GET" && url.pathname === "/api/v1/health") {
        return jsonResponse(res, 200, {
          ok: true,
          available: true,
          service: "prism-spectra-ai-gateway",
          mockExecutors: MOCK_EXECUTORS,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/local/status") {
        return jsonResponse(res, 200, await buildLocalStatus());
      }

      if (req.method === "POST" && url.pathname === "/api/v1/ai/request") {
        const body = await readBody(req);
        const validation = normalizeAiRequestBody(body);
        if (!validation.ok) return jsonResponse(res, 400, { ok: false, error: validation.error });
        const result = await engine.runAiRequest(validation.request);
        return jsonResponse(res, result.ok ? 200 : 500, result);
      }

      return jsonResponse(res, 404, { error: "not found" });
    } catch (error) {
      return jsonResponse(res, 500, { ok: false, error: (error as Error).message });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Prism Spectra AI gateway listening on http://${HOST}:${PORT}`);
    console.log(`Project cockpit available on http://${HOST}:${PORT}/cockpit`);
    if (!ENV_TOKEN) console.log(`Generated local token: ${TOKEN}`);
    console.log(`Mock executors: ${MOCK_EXECUTORS ? "on" : "off"}`);
  });
}

async function buildLocalStatus() {
  const cwd = process.cwd();
  const demoPath = path.resolve(cwd, ".demo");
  const ollamaPath = path.join(os.homedir(), ".ollama");
  const ollamaModelsPath = path.join(ollamaPath, "models");

  const [disk, ollamaStorage, ollamaModelsStorage, demoStorage, memory, ollama, thermal, topCpuProcess] = await Promise.all([
    diskFree("/"),
    directorySize(ollamaPath),
    directorySize(ollamaModelsPath),
    directorySize(demoPath),
    memoryPressure(),
    ollamaPs(),
    thermalStatus(),
    topCpu(),
  ]);

  return {
    ok: true,
    available: true,
    service: "prism-spectra-ai-gateway",
    generatedAt: new Date().toISOString(),
    gateway: {
      host: HOST,
      port: PORT,
      mockExecutors: MOCK_EXECUTORS,
      mode: MOCK_EXECUTORS ? "mock" : "real",
      dbPath: DB_PATH,
      workDir: WORK_DIR,
    },
    disk,
    storage: {
      ollama: ollamaStorage,
      ollamaModels: ollamaModelsStorage,
      spectraDemo: demoStorage,
    },
    memory,
    ollama,
    thermal,
    process: {
      topCpu: topCpuProcess,
    },
  };
}

async function diskFree(root: string) {
  try {
    const stats = await fs.statfs(root);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    return {
      ok: true,
      path: root,
      availableBytes,
      totalBytes,
      usedBytes: totalBytes - availableBytes,
      availableHuman: humanBytes(availableBytes),
      totalHuman: humanBytes(totalBytes),
    };
  } catch (error) {
    return { ok: false, path: root, error: (error as Error).message };
  }
}

async function directorySize(targetPath: string) {
  try {
    await fs.access(targetPath);
  } catch {
    return { ok: true, exists: false, path: targetPath, bytes: 0, human: "0 B" };
  }

  const result = await safeExec("du", ["-sk", targetPath]);
  if (!result.ok) return { ok: false, exists: true, path: targetPath, error: result.error, output: result.output };
  const kb = Number(String(result.output).trim().split(/\s+/)[0]);
  const bytes = Number.isFinite(kb) ? kb * 1024 : 0;
  return { ok: true, exists: true, path: targetPath, bytes, human: humanBytes(bytes) };
}

async function memoryPressure() {
  const result = await safeExec("memory_pressure", [], 4000);
  const output = result.output;
  const freeMatch = output.match(/System-wide memory free percentage:\s*(\d+)%/i);
  return {
    ok: result.ok,
    available: result.ok,
    freePercent: freeMatch ? Number(freeMatch[1]) : null,
    warning: result.ok ? /critical|urgent|warn/i.test(output) : false,
    output: output.slice(0, 1600),
    error: result.error,
  };
}

async function ollamaPs() {
  const result = await safeExec("ollama", ["ps"], 4000);
  const lines = result.output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const models = lines.slice(1).map(line => line.split(/\s+/)[0]).filter(Boolean);
  return {
    ok: result.ok,
    available: result.ok,
    loadedModels: models,
    output: result.output.slice(0, 2000),
    error: result.error,
  };
}

async function thermalStatus() {
  const result = await safeExec("pmset", ["-g", "therm"], 4000);
  const output = result.output;
  return {
    ok: result.ok,
    available: result.ok,
    warning: result.ok ? !/no thermal warning/i.test(output) && /warning|limit|thermal/i.test(output) : null,
    output: output.slice(0, 1600),
    error: result.error,
  };
}

async function topCpu() {
  const result = await safeExec("ps", ["-Ao", "pid,comm,%cpu,%mem,rss"], 4000);
  if (!result.ok) return { ok: false, error: result.error, output: result.output.slice(0, 1600) };
  const rows = result.output.split(/\r?\n/).slice(1).map(parsePsRow).filter(Boolean) as Array<{
    pid: number;
    command: string;
    cpuPercent: number;
    memoryPercent: number;
    rssKb: number;
  }>;
  rows.sort((a, b) => b.cpuPercent - a.cpuPercent);
  return { ok: true, rows: rows.slice(0, 10) };
}

function parsePsRow(line: string) {
  const match = line.trim().match(/^(\d+)\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s+(\d+)$/);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    command: match[2],
    cpuPercent: Number(match[3]),
    memoryPercent: Number(match[4]),
    rssKb: Number(match[5]),
  };
}

async function safeExec(command: string, args: string[], timeout = 3000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, maxBuffer: 512 * 1024 });
    return {
      ok: true,
      output: String(stdout ?? "").trim(),
      error: String(stderr ?? "").trim() || undefined,
    };
  } catch (error) {
    const err = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer; code?: string | number };
    const output = String(err.stdout ?? "").trim();
    const stderr = String(err.stderr ?? "").trim();
    return {
      ok: false,
      output,
      error: stderr || err.message || String(err.code ?? "command failed"),
    };
  }
}

function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

start().catch((error) => {
  console.error("Failed to start Prism Spectra AI gateway", error);
  process.exit(1);
});
