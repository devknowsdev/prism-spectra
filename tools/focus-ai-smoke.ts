#!/usr/bin/env -S tsx

const HOST = process.env.AI_FORGE_AI_GATEWAY_HOST ?? process.env.AI_FORGE_DAEMON_HOST ?? "127.0.0.1";
const PORT = Number(process.env.AI_FORGE_AI_GATEWAY_PORT ?? process.env.AI_FORGE_DAEMON_PORT ?? 3000);
const TOKEN = process.env.AI_FORGE_AI_GATEWAY_TOKEN ?? process.env.AI_FORGE_DAEMON_TOKEN ?? process.env.LOCAL_AI_TOKEN ?? "dev-local-token";
const BASE_URL = `http://${HOST}:${PORT}/api/v1`;

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-local-token": TOKEN,
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${path}: ${text}`);
  }

  return body;
}

async function main() {
  const health = await requestJson("/health");
  if (!health || typeof health !== "object" || !(health as { ok?: unknown }).ok) {
    throw new Error("Spectra AI gateway health check did not return ok=true");
  }

  const result = await requestJson("/ai/request", {
    method: "POST",
    body: JSON.stringify({
      sourceApp: "prism-focus",
      intent: "focus-ai-bridge-smoke-test",
      riskClass: "read-only",
      preferredMode: "local-first",
      nodeType: "docs",
      record: false,
      input: {
        prompt: "Reply with one short sentence confirming the Prism Focus AI bridge is connected.",
      },
      context: {
        appSurface: "spectra-focus-ai-smoke",
        purpose: "manual local integration check",
      },
    }),
  });

  if (!result || typeof result !== "object" || !(result as { ok?: unknown }).ok) {
    throw new Error(`AI request did not return ok=true: ${JSON.stringify(result)}`);
  }

  const provider = (result as { provider?: string }).provider ?? "unknown";
  const model = (result as { model?: string | null }).model ?? "unknown";
  const boundary = (result as { dataBoundary?: string }).dataBoundary ?? "unknown";
  const response = String((result as { response?: unknown }).response ?? "").slice(0, 160);

  console.log("  ok  - Spectra Focus AI gateway smoke");
  console.log(`       provider=${provider} model=${model} boundary=${boundary}`);
  console.log(`       response=${response}`);
}

main().catch((error) => {
  console.error("Spectra Focus AI gateway smoke failed");
  console.error(error);
  process.exit(1);
});
