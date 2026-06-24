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
  });
}

start().catch((error) => {
  console.error("Failed to start Prism Spectra AI gateway", error);
  process.exit(1);
});
