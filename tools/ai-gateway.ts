#!/usr/bin/env -S tsx

import http from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ExecutionEngine, normalizeAiRequestBody } from "../src/index.js";

const PORT = Number(process.env.AI_FORGE_AI_GATEWAY_PORT ?? process.env.AI_FORGE_DAEMON_PORT ?? 3000);
const HOST = process.env.AI_FORGE_AI_GATEWAY_HOST ?? process.env.AI_FORGE_DAEMON_HOST ?? "127.0.0.1";
const ENV_TOKEN = process.env.AI_FORGE_AI_GATEWAY_TOKEN ?? process.env.AI_FORGE_DAEMON_TOKEN ?? process.env.LOCAL_AI_TOKEN;
const TOKEN = ENV_TOKEN || randomBytes(18).toString("hex");
const DB_PATH = process.env.AI_FORGE_AI_GATEWAY_DB ?? ".demo/ai-gateway.db";
const WORK_DIR = process.env.AI_FORGE_AI_GATEWAY_WORKDIR ?? path.join(".demo", "ai-gateway-work");
const MOCK_EXECUTORS = process.env.AI_FORGE_MOCK_EXECUTORS !== "0";
const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_GENERAL_MODEL = process.env.OLLAMA_GENERAL_MODEL ?? "qwen3:9b";
const OLLAMA_CODER_MODEL = process.env.OLLAMA_CODER_MODEL ?? "qwen2.5-coder:7b";

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

async function ollamaJson(pathname: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${OLLAMA_HOST}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama ${pathname} HTTP ${response.status} ${text.slice(0, 200)}`.trim());
  }
  return response.json();
}

function configuredModels() {
  return [
    { role: "general", name: OLLAMA_GENERAL_MODEL },
    { role: "coder", name: OLLAMA_CODER_MODEL },
  ];
}

function normalizeModelName(value: unknown): string {
  return String(value ?? "").trim();
}

function modelAllowed(model: string): boolean {
  return configuredModels().some((entry) => entry.name === model);
}

async function getModelStatus() {
  const configured = configuredModels();
  let installedNames: string[] = [];
  let loadedNames: string[] | null = null;
  let loadedStatusError: string | null = null;

  const tags = (await ollamaJson("/api/tags")) as { models?: Array<{ name?: string }> };
  installedNames = (tags.models ?? []).map((model) => String(model.name ?? "")).filter(Boolean);

  try {
    const ps = (await ollamaJson("/api/ps")) as { models?: Array<{ name?: string }> };
    loadedNames = (ps.models ?? []).map((model) => String(model.name ?? "")).filter(Boolean);
  } catch (error) {
    loadedStatusError = (error as Error).message;
  }

  return {
    ok: true,
    ollamaHost: OLLAMA_HOST,
    mockExecutors: MOCK_EXECUTORS,
    models: configured.map((entry) => ({
      ...entry,
      installed: installedNames.includes(entry.name),
      loaded: loadedNames ? loadedNames.includes(entry.name) : null,
    })),
    installedModels: installedNames,
    loadedModels: loadedNames,
    loadedStatusError,
  };
}

async function warmModel(body: unknown) {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const role = String(raw.role ?? "general");
  const fallback = role === "coder" ? OLLAMA_CODER_MODEL : OLLAMA_GENERAL_MODEL;
  const model = normalizeModelName(raw.model) || fallback;
  if (!modelAllowed(model)) {
    return { ok: false, error: "model must be one of the configured Spectra models", model };
  }

  const result = await ollamaJson("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      model,
      prompt: "Reply with exactly: ready",
      stream: false,
      keep_alive: raw.keepAlive ?? "10m",
      options: {
        num_predict: 8,
        temperature: 0,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  }) as { response?: string };

  return {
    ok: true,
    model,
    response: String(result.response ?? "").trim(),
  };
}

async function unloadModel(body: unknown) {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const role = String(raw.role ?? "general");
  const fallback = role === "coder" ? OLLAMA_CODER_MODEL : OLLAMA_GENERAL_MODEL;
  const model = normalizeModelName(raw.model) || fallback;
  if (!modelAllowed(model)) {
    return { ok: false, error: "model must be one of the configured Spectra models", model };
  }

  await ollamaJson("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      model,
      prompt: "",
      stream: false,
      keep_alive: 0,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  return {
    ok: true,
    model,
    unloaded: true,
  };
}

async function start() {
  const engine = new ExecutionEngine({
    dbPath: DB_PATH,
    workDir: WORK_DIR,
    mockExecutors: MOCK_EXECUTORS,
    fallbackOnFailure: false,
  });
  await engine.init();

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

      const provided = req.headers["x-local-token"];
      if (provided !== TOKEN) return unauthorized(res);

      if (req.method === "GET" && url.pathname === "/api/v1/health") {
        return jsonResponse(res, 200, {
          ok: true,
          available: true,
          service: "prism-spectra-ai-gateway",
          mockExecutors: MOCK_EXECUTORS,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/models/status") {
        return jsonResponse(res, 200, await getModelStatus());
      }

      if (req.method === "POST" && url.pathname === "/api/v1/models/warm") {
        const body = await readBody(req);
        const result = await warmModel(body);
        return jsonResponse(res, result.ok ? 200 : 400, result);
      }

      if (req.method === "POST" && url.pathname === "/api/v1/models/unload") {
        const body = await readBody(req);
        const result = await unloadModel(body);
        return jsonResponse(res, result.ok ? 200 : 400, result);
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
    if (!ENV_TOKEN) console.log(`Generated local token: ${TOKEN}`);
    console.log(`Mock executors: ${MOCK_EXECUTORS ? "on" : "off"}`);
    console.log(`Ollama host: ${OLLAMA_HOST}`);
    console.log(`Configured models: general=${OLLAMA_GENERAL_MODEL}, coder=${OLLAMA_CODER_MODEL}`);
  });
}

start().catch((error) => {
  console.error("Failed to start Prism Spectra AI gateway", error);
  process.exit(1);
});
