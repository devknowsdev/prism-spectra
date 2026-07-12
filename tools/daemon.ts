#!/usr/bin/env -S tsx
/* Minimal local HTTP daemon for AI-Forge POC
   Run with: `tsx tools/daemon.ts`
   Binds to 127.0.0.1:3000 and exposes a tiny JSON API for `build-graph`, `route`, `health`.
*/
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GraphBuilder,
  ExecutionEngine,
  InMemoryApprovalQueue,
  InMemoryPrismEventLedger,
  approvalDecisionStatuses,
  type MemoryDB,
  type PrismEventType,
  getWorkbenchAttachment,
  getWorkbenchConversation,
  buildWorkbenchApprovals,
  buildWorkbenchChanges,
  listWorkbenchAttachments,
  listWorkbenchConversations,
  buildWorkbenchResume,
  seedCapabilityManifests,
  createCurrentSession,
  type PrismEvent,
  type SpectraSession,
  checkAllCloudTeacherHealth,
  loadCapabilityManifestRegistry,
  normalizeAiRequestBody,
} from "../src/index.js";
import { TaskGraph } from "../src/taskGraph/graph.js";
import { probeAllProviders, applyProviderProbe, type ProviderStatus } from "../src/config/providerProbe.js";
import {
  createWorkbenchWatcher,
  subscribeWorkbenchReloadSse,
  WorkbenchReloadHub,
} from "../src/workbench/liveReload.js";
import {
  createAppPreviews,
  injectAppPreviewLiveReload,
  loadWorkbenchChangePipelineConfig,
  loadAppPreviewChangePipelineConfigs,
  loadAppPreviewDirectories,
  resolveAppPreviewFile,
  type AppPreview,
  type AppPreviewName,
} from "../src/workbench/appPreview.js";
import type { WorkbenchChangePipelineConfig } from "../src/workbench/changePipeline.js";
import { handleWorkbenchChangePipeline } from "../src/workbench/changePipeline.js";
import { listReadOnlyGitStatus } from "../src/git/readOnlyGit.js";

const PORT = Number(process.env.AI_FORGE_DAEMON_PORT ?? 3000);
const HOST = process.env.AI_FORGE_DAEMON_HOST ?? "127.0.0.1";
const ENV_TOKEN = process.env.AI_FORGE_DAEMON_TOKEN ?? process.env.LOCAL_AI_TOKEN;
const TOKEN = ENV_TOKEN || randomBytes(18).toString("hex");
const DAEMON_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKBENCH_DIR = path.resolve(DAEMON_DIR, "../ui/workbench");
const WORKBENCH_HTML_PATH = path.join(WORKBENCH_DIR, "index.html");
const WORKBENCH_ROADMAP_PATH = path.join(WORKBENCH_DIR, "roadmap.json");
const WORKBENCH_SHIM_DIR = path.join(WORKBENCH_DIR, "vendor-shims");
const WORKBENCH_JS_DIR = path.join(WORKBENCH_DIR, "js");
const APP_PREVIEW_JS_DIR = path.resolve(DAEMON_DIR, "../ui/preview/js");
const NODE_MODULES_DIR = path.resolve(DAEMON_DIR, "../node_modules");
const WORKBENCH_WATCH_ENABLED = process.env.AI_FORGE_WORKBENCH_WATCH === "1";
const APP_PREVIEW_ENABLED = process.env.AI_FORGE_APP_PREVIEW === "1";
const SHELL_MOUNT_ENABLED = process.env.AI_FORGE_SHELL_MOUNT !== "0";
const APP_PREVIEW_BASE_PORT = Number(
  process.env.AI_FORGE_APP_PREVIEW_BASE_PORT ?? PORT + 1,
);
const APP_PREVIEW_CONFIG_PATH = path.resolve(
  process.env.AI_FORGE_APP_PREVIEW_CONFIG ?? path.join(process.cwd(), "spectra.preview.local.json"),
);
const AI_STATUS_PROBE_TIMEOUT_MS = 4_000;

type AiProviderKind = "local" | "cloud";

interface AiProviderAvailability {
  id: "ollama" | "anthropic" | "openai";
  kind: AiProviderKind;
  available: boolean;
  reason?: string;
}

async function initEngine() {
  const mockExecutors = process.env.AI_FORGE_MOCK_EXECUTORS === "1";
  const engine = new ExecutionEngine({ dbPath: ".demo/daemon.db", workDir: ".demo/work", mockExecutors, fallbackOnFailure: false });
  await engine.init();
  await loadStartupCapabilityManifests();
  const statuses = await probeAllProviders();
  if (!mockExecutors) {
    applyProviderProbe(engine, statuses);
    const ollamaStatus = statuses.find(s => s.provider === "ollama");
    if (!ollamaStatus?.available) {
      console.warn("[daemon] Ollama unavailable at startup — local tier disabled:", ollamaStatus?.reason ?? "no reason given");
    }
  }
  const graphBuilder = new GraphBuilder(engine.memory, engine.taskHistory);
  return { engine, graphBuilder };
}

function jsonResponse(res: http.ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "x-local-token,content-type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  });
  res.end(s);
}

function sseEvent(event: PrismEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}

function wantsEventStream(req: http.IncomingMessage): boolean {
  return String(req.headers.accept || "").includes("text/event-stream");
}

function subscribeEventLedgerSse(
  eventLedger: InMemoryPrismEventLedger,
  handler: (event: string) => void,
): () => void {
  return eventLedger.subscribe((event) => {
    handler(sseEvent(event));
  });
}

function unauthorized(res: http.ServerResponse) {
  jsonResponse(res, 401, { error: "missing or invalid x-local-token header" });
}

function scriptJson(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function isLoopbackRequest(req: http.IncomingMessage): boolean {
  const address = req.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function readBody(req: http.IncomingMessage): Promise<any> {
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

function sendHtml(res: http.ServerResponse, html: string) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(html);
}

async function loadStartupCapabilityManifests() {
  const result = loadCapabilityManifestRegistry({ directory: path.resolve(process.cwd(), "capabilities") });
  console.log(`[capabilities] loaded ${result.loaded.length} file-backed capability manifests with ${result.issues.length} issue(s)`);
}

async function readWorkbenchHtml(): Promise<string> {
  return fs.promises.readFile(WORKBENCH_HTML_PATH, "utf-8");
}

async function readWorkbenchRoadmap(): Promise<unknown> {
  const source = await fs.promises.readFile(WORKBENCH_ROADMAP_PATH, "utf-8");
  return JSON.parse(source);
}

function normalizeProbeReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  return reason.slice(0, 240);
}

function unavailableAiProviders(reason: string): { providers: AiProviderAvailability[] } {
  return {
    providers: [
      { id: "ollama", kind: "local", available: false, reason },
      { id: "anthropic", kind: "cloud", available: false, reason },
      { id: "openai", kind: "cloud", available: false, reason },
    ],
  };
}

async function probeProvidersWithTimeout(): Promise<ProviderStatus[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probeAllProviders(),
      new Promise<ProviderStatus[]>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("provider probe timed out")), AI_STATUS_PROBE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readAiProviderStatus(): Promise<{ providers: AiProviderAvailability[] }> {
  try {
    const statuses = await probeProvidersWithTimeout();
    const byProvider = new Map(statuses.map((status) => [status.provider, status]));
    const providers: AiProviderAvailability[] = [
      { id: "ollama", kind: "local", available: false, reason: "provider probe did not return ollama" },
      { id: "anthropic", kind: "cloud", available: false, reason: "provider probe did not return claude" },
      { id: "openai", kind: "cloud", available: false, reason: "provider probe did not return gpt" },
    ];
    const mapping: Array<[AiProviderAvailability["id"], ProviderStatus["provider"]]> = [
      ["ollama", "ollama"],
      ["anthropic", "claude"],
      ["openai", "gpt"],
    ];

    for (const [id, provider] of mapping) {
      const source = byProvider.get(provider);
      const target = providers.find((item) => item.id === id);
      if (!source || !target) continue;
      target.available = source.available;
      target.reason = normalizeProbeReason(source.reason);
    }

    return { providers };
  } catch (error) {
    const message = error instanceof Error && error.message === "provider probe timed out"
      ? "provider probe timed out"
      : "provider probe failed";
    return unavailableAiProviders(message);
  }
}

function injectShellMountFlag(html: string): string {
  const flagScript = "<script>window.__SPECTRA_SHELL_MOUNT = true;</script>";
  if (html.includes(flagScript)) return html;
  const closingHead = /<\/head\s*>/i;
  if (closingHead.test(html)) {
    return html.replace(closingHead, `${flagScript}\n</head>`);
  }
  return `${flagScript}\n${html}`;
}

function injectWorkbenchLocalToken(html: string): string {
  const tokenScript = `<script>window.__SPECTRA_LOCAL_TOKEN = ${scriptJson(TOKEN)};</script>`;
  if (html.includes("<script>window.__SPECTRA_LOCAL_TOKEN = ")) return html;
  const closingHead = /<\/head\s*>/i;
  if (closingHead.test(html)) {
    return html.replace(closingHead, `${tokenScript}\n</head>`);
  }
  return `${tokenScript}\n${html}`;
}

function injectWorkbenchRuntime(html: string): string {
  const withToken = injectWorkbenchLocalToken(html);
  return SHELL_MOUNT_ENABLED ? injectShellMountFlag(withToken) : withToken;
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".map") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".woff") return "font/woff";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".ttf") return "font/ttf";
  if (ext === ".wasm") return "application/wasm";
  if (ext === ".txt" || ext === ".md" || ext === ".yml" || ext === ".yaml") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function sanitizeAttachmentFilename(filename: string): string {
  const raw = filename.trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return safe.length > 0 ? safe : "";
}

function decodeBase64Strict(contentBase64: string): Buffer | null {
  const normalized = contentBase64.replace(/\s+/g, "");
  if (normalized.length === 0) return Buffer.alloc(0);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) return null;
  const buffer = Buffer.from(normalized, "base64");
  const reencoded = buffer.toString("base64").replace(/=+$/, "");
  const input = normalized.replace(/=+$/, "");
  return reencoded === input ? buffer : null;
}

function normalizeAttachmentDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\r\n\0]+/g, " ").trim().replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeAttachmentTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function attachmentRowById(db: MemoryDB["db"], attachmentId: number) {
  return db.prepare(
    "SELECT id, conversation_id, filename, path, content_type, size, sha256, created_at FROM attachments WHERE id = ? LIMIT 1"
  ).get(attachmentId) as Record<string, unknown> | undefined;
}

function attachmentTagsById(db: MemoryDB["db"], attachmentId: number): string[] {
  return (db.prepare("SELECT tag FROM attachment_tags WHERE attachment_id = ? ORDER BY created_at ASC, id ASC").all(attachmentId) as Record<string, unknown>[])
    .map((row) => normalizeAttachmentTag(row.tag) || "")
    .filter((tag) => tag.length > 0);
}

function appendAttachmentLedgerEvent(
  eventLedger: InMemoryPrismEventLedger,
  type: PrismEventType,
  summary: string,
  attachmentId: number,
  filename: string | null,
  extraMetadata: Record<string, unknown> = {},
  severity: "info" | "low" | "medium" | "high" = "info",
) {
  eventLedger.append({
    type,
    summary,
    severity,
    source: type.startsWith("artifact.") ? "artifact" : "attachment",
    relatedArtifactId: `attachment:${attachmentId}`,
    metadata: {
      attachmentId,
      filename,
      ...extraMetadata,
    },
  });
}

function recordAttachmentAudit(
  engine: ExecutionEngine,
  attachmentId: number,
  action: string,
  details: Record<string, unknown>,
  actor: string,
) {
  try {
    engine.memory.db.prepare("INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)")
      .run(attachmentId, action, JSON.stringify(details), actor);
  } catch (error) {}
}

function updateAttachmentDisplayName(
  engine: ExecutionEngine,
  eventLedger: InMemoryPrismEventLedger,
  attachmentId: number,
  displayName: unknown,
  actor: string,
) {
  const current = attachmentRowById(engine.memory.db, attachmentId);
  if (!current) {
    return { code: 404, body: { error: "attachment not found" } };
  }

  const nextDisplayName = normalizeAttachmentDisplayName(displayName);
  if (!nextDisplayName) {
    return { code: 400, body: { error: "expected non-empty displayName" } };
  }
  if (nextDisplayName.length > 255) {
    return { code: 400, body: { error: "displayName too long (max 255 chars)" } };
  }

  const currentDisplayName = String(current.filename || "").trim();
  if (currentDisplayName === nextDisplayName) {
    return { code: 200, body: { attachment: getWorkbenchAttachment(engine.memory, attachmentId, eventLedger) } };
  }

  engine.memory.db.prepare("UPDATE attachments SET filename = ? WHERE id = ?").run(nextDisplayName, attachmentId);
  recordAttachmentAudit(engine, attachmentId, "metadata_update", { from: currentDisplayName || null, to: nextDisplayName, fields: ["displayName"] }, actor);
  appendAttachmentLedgerEvent(
    eventLedger,
    "attachment.metadata.updated",
    `Attachment display name updated to ${nextDisplayName}`,
    attachmentId,
    nextDisplayName,
    { from: currentDisplayName || null, to: nextDisplayName, fields: ["displayName"], actor },
  );

  return { code: 200, body: { attachment: getWorkbenchAttachment(engine.memory, attachmentId, eventLedger) } };
}

function addAttachmentTag(
  engine: ExecutionEngine,
  eventLedger: InMemoryPrismEventLedger,
  attachmentId: number,
  tagInput: unknown,
  actor: string,
) {
  const current = attachmentRowById(engine.memory.db, attachmentId);
  if (!current) {
    return { code: 404, body: { error: "attachment not found" } };
  }

  const tag = normalizeAttachmentTag(tagInput);
  if (!tag) {
    return { code: 400, body: { error: "expected non-empty tag" } };
  }

  const exists = engine.memory.db.prepare("SELECT 1 FROM attachment_tags WHERE attachment_id = ? AND tag = ? LIMIT 1").get(attachmentId, tag);
  if (!exists) {
    engine.memory.db.prepare("INSERT INTO attachment_tags (attachment_id, tag) VALUES (?, ?)").run(attachmentId, tag);
    recordAttachmentAudit(engine, attachmentId, "tag_add", { tag }, actor);
    appendAttachmentLedgerEvent(
      eventLedger,
      "attachment.tag.added",
      `Attachment tag added: ${tag}`,
      attachmentId,
      String(current.filename || attachmentId),
      { tag, actor },
    );
  }

  return {
    code: 200,
    body: {
      id: attachmentId,
      tags: attachmentTagsById(engine.memory.db, attachmentId),
      attachment: getWorkbenchAttachment(engine.memory, attachmentId, eventLedger),
    },
  };
}

function removeAttachmentTag(
  engine: ExecutionEngine,
  eventLedger: InMemoryPrismEventLedger,
  attachmentId: number,
  tagInput: unknown,
  actor: string,
) {
  const current = attachmentRowById(engine.memory.db, attachmentId);
  if (!current) {
    return { code: 404, body: { error: "attachment not found" } };
  }

  const tag = normalizeAttachmentTag(tagInput);
  if (!tag) {
    return { code: 400, body: { error: "expected non-empty tag" } };
  }

  const result = engine.memory.db.prepare("DELETE FROM attachment_tags WHERE attachment_id = ? AND tag = ?").run(attachmentId, tag);
  if (Number(result?.changes ?? 0) > 0) {
    recordAttachmentAudit(engine, attachmentId, "tag_remove", { tag }, actor);
    appendAttachmentLedgerEvent(
      eventLedger,
      "attachment.tag.removed",
      `Attachment tag removed: ${tag}`,
      attachmentId,
      String(current.filename || attachmentId),
      { tag, actor },
    );
  }

  return {
    code: 200,
    body: {
      id: attachmentId,
      tags: attachmentTagsById(engine.memory.db, attachmentId),
      attachment: getWorkbenchAttachment(engine.memory, attachmentId, eventLedger),
    },
  };
}

function inlineFilenameValue(filename: string): { fallback: string; encoded: string } {
  const raw = filename.trim() || "preview";
  const fallback = raw.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(raw)
    .replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
  return { fallback, encoded };
}

function isSafeAttachmentPreviewPath(candidatePath: string, baseDir: string): boolean {
  const resolved = path.resolve(candidatePath);
  const boundary = baseDir.endsWith(path.sep) ? baseDir : `${baseDir}${path.sep}`;
  return resolved === baseDir || resolved.startsWith(boundary);
}

async function resolveSafeAttachmentPreviewPath(storedPath: string): Promise<{ resolvedPath: string; uploadsBase: string } | null> {
  const uploadsBase = await fs.promises.realpath(attachmentUploadsDir());
  const resolvedPath = await fs.promises.realpath(storedPath);
  if (!isSafeAttachmentPreviewPath(resolvedPath, uploadsBase)) {
    return null;
  }
  return { resolvedPath, uploadsBase };
}

function appendAttachmentPreviewEvent(
  eventLedger: InMemoryPrismEventLedger,
  type:
    | "attachment.preview.requested"
    | "attachment.preview.available"
    | "attachment.preview.blocked"
    | "attachment.preview.failed"
    | "attachment.audio.preview.opened"
    | "attachment.audio.preview.ready"
    | "attachment.audio.preview.closed"
    | "attachment.audio.preview.failed",
  summary: string,
  attachmentId: number,
  filename: string | null,
  previewKind: string,
  previewStatus: string,
  extraMetadata: Record<string, unknown> = {},
) {
  eventLedger.append({
    type,
    summary,
    severity: type === "attachment.preview.failed" ? "high" : type === "attachment.preview.blocked" ? "low" : "info",
    source: "attachment",
    relatedArtifactId: `attachment:${attachmentId}`,
    metadata: {
      attachmentId,
      filename,
      previewKind,
      previewStatus,
      ...extraMetadata,
    },
  });
}

async function sendWorkbenchAttachmentPreview(
  res: http.ServerResponse,
  engine: ExecutionEngine,
  eventLedger: InMemoryPrismEventLedger,
  attachmentId: number,
) {
  const attachment = getWorkbenchAttachment(engine.memory, attachmentId, eventLedger);
  if (!attachment) {
    return jsonResponse(res, 404, { error: "attachment not found" });
  }

  appendAttachmentPreviewEvent(
    eventLedger,
    "attachment.preview.requested",
    `Preview requested for ${attachment.displayName || attachment.filename || `attachment ${attachmentId}`}`,
    attachmentId,
    attachment.displayName || attachment.filename || null,
    attachment.preview.kind,
    attachment.preview.status,
  );

  if (!attachment.preview.safeToRenderInline || attachment.preview.status !== "available") {
    appendAttachmentPreviewEvent(
      eventLedger,
      "attachment.preview.blocked",
      `Preview blocked for ${attachment.displayName || attachment.filename || `attachment ${attachmentId}`}`,
      attachmentId,
      attachment.displayName || attachment.filename || null,
      attachment.preview.kind,
      attachment.preview.status,
      {
        reason: attachment.preview.reason || "preview unavailable",
      },
    );
    return jsonResponse(res, 415, {
      error: attachment.preview.reason || "preview unavailable",
      preview: attachment.preview,
    });
  }

  const row = attachmentRowById(engine.memory.db, attachmentId);
  if (!row) {
    appendAttachmentPreviewEvent(
      eventLedger,
      "attachment.preview.failed",
      `Preview failed for attachment ${attachmentId}`,
      attachmentId,
      attachment.displayName || attachment.filename || null,
      attachment.preview.kind,
      attachment.preview.status,
      { reason: "attachment row missing" },
    );
    return jsonResponse(res, 404, { error: "attachment not found" });
  }

  const storedPath = String(row.path || "");
  if (!storedPath) {
    appendAttachmentPreviewEvent(
      eventLedger,
      "attachment.preview.blocked",
      `Preview blocked for ${attachment.displayName || attachment.filename || `attachment ${attachmentId}`}`,
      attachmentId,
      attachment.displayName || attachment.filename || null,
      attachment.preview.kind,
      attachment.preview.status,
      { reason: "unsafe attachment path" },
    );
    return jsonResponse(res, 403, { error: "preview path is not allowed", preview: attachment.preview });
  }

  let resolvedPath: string | null = null;
  try {
    const safePath = await resolveSafeAttachmentPreviewPath(storedPath);
    resolvedPath = safePath?.resolvedPath ?? null;
  } catch (error) {
    appendAttachmentPreviewEvent(
      eventLedger,
      "attachment.preview.blocked",
      `Preview blocked for ${attachment.displayName || attachment.filename || `attachment ${attachmentId}`}`,
      attachmentId,
      attachment.displayName || attachment.filename || null,
      attachment.preview.kind,
      attachment.preview.status,
      { reason: "unsafe attachment path" },
    );
    return jsonResponse(res, 403, { error: "preview path is not allowed", preview: attachment.preview });
  }

  if (!resolvedPath) {
    appendAttachmentPreviewEvent(
      eventLedger,
      "attachment.preview.blocked",
      `Preview blocked for ${attachment.displayName || attachment.filename || `attachment ${attachmentId}`}`,
      attachmentId,
      attachment.displayName || attachment.filename || null,
      attachment.preview.kind,
      attachment.preview.status,
      { reason: "unsafe attachment path" },
    );
    return jsonResponse(res, 403, { error: "preview path is not allowed", preview: attachment.preview });
  }

  try {
    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new Error("attachment path is not a file");
    }

    const mimeType = typeof row.content_type === "string" && row.content_type.trim().length > 0
      ? row.content_type.trim()
      : "application/octet-stream";
    const filename = String(row.filename || `attachment-${attachmentId}`);
    const { fallback, encoded } = inlineFilenameValue(filename);

    appendAttachmentPreviewEvent(
      eventLedger,
      "attachment.preview.available",
      `Preview available for ${filename}`,
      attachmentId,
      filename,
      attachment.preview.kind,
      attachment.preview.status,
      {
        contentType: mimeType,
        resolved: true,
        sizeBytes: stat.size,
      },
    );

    res.writeHead(200, {
      "Content-Type": mimeType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    const stream = fs.createReadStream(resolvedPath);
    stream.on("error", () => {
      try {
        if (!res.headersSent) {
          appendAttachmentPreviewEvent(
            eventLedger,
            "attachment.preview.failed",
            `Preview failed for ${filename}`,
            attachmentId,
            filename,
            attachment.preview.kind,
            attachment.preview.status,
            { reason: "stream error" },
          );
          jsonResponse(res, 500, { error: "could not read attachment preview" });
        } else {
          res.destroy();
        }
      } catch (error) {}
    });
    stream.pipe(res);
    return;
  } catch (error) {
    appendAttachmentPreviewEvent(
      eventLedger,
      "attachment.preview.failed",
      `Preview failed for ${attachment.displayName || attachment.filename || `attachment ${attachmentId}`}`,
      attachmentId,
      attachment.displayName || attachment.filename || null,
      attachment.preview.kind,
      attachment.preview.status,
      { reason: "could not read attachment preview" },
    );
    return jsonResponse(res, 500, { error: "could not read attachment preview" });
  }
}

async function sendVendorFile(res: http.ServerResponse, requestPath: string) {
  const relative = decodeURIComponent(requestPath.replace(/^\/vendor\//, ""));
  const resolved = path.resolve(NODE_MODULES_DIR, relative);
  const boundary = NODE_MODULES_DIR.endsWith(path.sep) ? NODE_MODULES_DIR : `${NODE_MODULES_DIR}${path.sep}`;
  if (resolved !== NODE_MODULES_DIR && !resolved.startsWith(boundary)) {
    return jsonResponse(res, 403, { error: "not allowed" });
  }

  try {
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) {
      return jsonResponse(res, 404, { error: "not found" });
    }
    const content = await fs.promises.readFile(resolved);
    res.writeHead(200, {
      "Content-Type": contentTypeForPath(resolved),
      "Content-Length": String(content.length),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    return res.end(content);
  } catch (error) {
    return jsonResponse(res, 404, { error: "not found" });
  }
}

async function sendWorkbenchShimFile(res: http.ServerResponse, requestPath: string) {
  const relative = decodeURIComponent(requestPath.replace(/^\/workbench-shims\//, ""));
  const isWorkbenchModule = relative.startsWith("js/");
  const root = isWorkbenchModule ? WORKBENCH_JS_DIR : WORKBENCH_SHIM_DIR;
  const rootRelative = isWorkbenchModule ? relative.slice("js/".length) : relative;
  const resolved = path.resolve(root, rootRelative);
  const boundary = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(boundary)) {
    return jsonResponse(res, 403, { error: "not allowed" });
  }

  try {
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) {
      return jsonResponse(res, 404, { error: "not found" });
    }
    const content = await fs.promises.readFile(resolved);
    res.writeHead(200, {
      "Content-Type": contentTypeForPath(resolved),
      "Content-Length": String(content.length),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    return res.end(content);
  } catch (error) {
    return jsonResponse(res, 404, { error: "not found" });
  }
}

async function sendAppPreviewClient(res: http.ServerResponse) {
  const clientPath = path.join(APP_PREVIEW_JS_DIR, "livereload.js");
  try {
    const content = await fs.promises.readFile(clientPath);
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Content-Length": String(content.length),
      "Cache-Control": "no-store",
    });
    return res.end(content);
  } catch {
    return jsonResponse(res, 404, { error: "not found" });
  }
}

async function sendAppPreviewFile(
  res: http.ServerResponse,
  appDir: string,
  requestRelativePath: string,
) {
  const filePath = await resolveAppPreviewFile(appDir, requestRelativePath);
  if (!filePath) return jsonResponse(res, 404, { error: "not found" });

  try {
    if (path.extname(filePath).toLowerCase() === ".html") {
      const source = await fs.promises.readFile(filePath, "utf-8");
      return sendHtml(res, injectAppPreviewLiveReload(source));
    }

    const content = await fs.promises.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypeForPath(filePath),
      "Content-Length": String(content.length),
      "Cache-Control": "no-store",
    });
    return res.end(content);
  } catch {
    return jsonResponse(res, 404, { error: "not found" });
  }
}

interface RunningAppPreview {
  preview: AppPreview;
  port: number;
  url: string;
  server: http.Server;
}

function appPreviewPort(app: AppPreviewName): number {
  return APP_PREVIEW_BASE_PORT + (app === "focus" ? 0 : 1);
}

function shellMounts(runningAppPreviews: ReadonlyMap<AppPreviewName, RunningAppPreview>) {
  if (!SHELL_MOUNT_ENABLED) return [];

  const epkPreview = runningAppPreviews.get("epk");
  if (!epkPreview) return [];
  const focusPreview = runningAppPreviews.get("focus");

  const mounts = [
    {
      id: "epk-publisher",
      label: "Mounted surface — EPK",
      subtitle: "EPK Publisher mounted from the existing loopback app preview.",
      shortcut: "9",
      url: new URL("publisher/", epkPreview.url).toString(),
    },
    {
      id: "epk-admin",
      label: "Mounted surface — EPK Admin",
      subtitle: "EPK Admin mounted from the existing loopback app preview.",
      shortcut: "0",
      url: new URL("admin/admin.html", epkPreview.url).toString(),
    },
  ];

  if (focusPreview) {
    mounts.push({
      id: "focus",
      label: "Mounted surface — Focus",
      subtitle: "Focus dashboard mounted from the existing loopback app preview.",
      url: new URL("index.html", focusPreview.url).toString(),
    });
  }

  return mounts;
}

async function startAppPreviewServers(
  previews: ReadonlyMap<AppPreviewName, AppPreview>,
): Promise<Map<AppPreviewName, RunningAppPreview>> {
  if (
    previews.size > 0
    && (!Number.isInteger(APP_PREVIEW_BASE_PORT)
      || APP_PREVIEW_BASE_PORT < 1
      || APP_PREVIEW_BASE_PORT > 65534)
  ) {
    throw new Error("AI_FORGE_APP_PREVIEW_BASE_PORT must be an integer from 1 to 65534");
  }

  const running = new Map<AppPreviewName, RunningAppPreview>();
  try {
    for (const [app, preview] of previews) {
      const port = appPreviewPort(app);
      const previewServer = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url ?? "", `http://${req.headers.host}`);
          if (req.method === "GET" && url.pathname === "/preview/js/livereload.js") {
            return sendAppPreviewClient(res);
          }
          if (url.pathname === "/api/v1/preview/live") {
            if (req.method === "HEAD") {
              res.writeHead(204, { "Cache-Control": "no-store" });
              return res.end();
            }
            if (req.method === "GET") {
              res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-store",
                "Connection": "keep-alive",
              });
              res.write(": connected\n\n");
              const unsubscribe = subscribeWorkbenchReloadSse(
                preview.reloadHub,
                (event) => res.write(event),
              );
              req.once("close", unsubscribe);
              return;
            }
          }
          if (req.method === "GET") {
            return sendAppPreviewFile(res, preview.directory, url.pathname);
          }
          return jsonResponse(res, 404, { error: "not found" });
        } catch (error) {
          return jsonResponse(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      await new Promise<void>((resolve, reject) => {
        previewServer.once("error", reject);
        previewServer.listen(port, "127.0.0.1", () => {
          previewServer.off("error", reject);
          resolve();
        });
      });
      running.set(app, {
        preview,
        port,
        url: `http://127.0.0.1:${port}/`,
        server: previewServer,
      });
    }
    return running;
  } catch (error) {
    for (const item of running.values()) item.server.close();
    throw error;
  }
}

function attachmentUploadsDir(): string {
  return process.env.AI_FORGE_UPLOADS_DIR || path.join(process.cwd(), "uploads");
}

function safeRequestedFilename(filename: unknown): string {
  if (typeof filename !== "string") return "";
  return sanitizeAttachmentFilename(filename);
}

function optionalConversationId(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBase64Attachment(contentBase64: unknown): Buffer | null {
  if (typeof contentBase64 !== "string") return null;
  return decodeBase64Strict(contentBase64);
}

function appendAttachmentIngestEvent(
  eventLedger: InMemoryPrismEventLedger,
  type: PrismEventType,
  summary: string,
  attachmentId: number | null,
  filename: string,
  contentType: string | null,
  size: number,
  conversationId: number | null,
  sha256: string | null,
  extraMetadata: Record<string, unknown> = {},
) {
  eventLedger.append({
    type,
    summary,
    severity: type === "attachment.ingest.cancelled" ? "low" : "info",
    source: type.startsWith("artifact.") ? "artifact" : "attachment",
    relatedArtifactId: attachmentId == null ? undefined : `attachment:${attachmentId}`,
    relatedConversationId: conversationId == null ? undefined : String(conversationId),
    metadata: {
      attachmentId,
      filename,
      contentType,
      size,
      sha256,
      ...extraMetadata,
    },
  });
}

async function importLocalAttachmentFromBody(
  engine: ExecutionEngine,
  eventLedger: InMemoryPrismEventLedger,
  body: any,
  actor: string,
  routeLabel: string,
) {
  const filename = safeRequestedFilename(body?.filename);
  const contentBuffer = parseBase64Attachment(body?.contentBase64);
  const contentType = typeof body?.contentType === "string" && body.contentType.trim().length > 0 ? body.contentType.trim() : null;
  const conversationId = optionalConversationId(body?.conversationId);

  if (!filename) {
    return { code: 400, body: { error: "expected {filename, contentBase64, contentType?, conversationId?}" } };
  }

  if (!contentBuffer) {
    return { code: 400, body: { error: "contentBase64 must be valid base64" } };
  }

  const maxBytes = Number(process.env.AI_FORGE_MAX_UPLOAD_BYTES || 20 * 1024 * 1024);
  if (contentBuffer.length > maxBytes) {
    return { code: 413, body: { error: "file too large" } };
  }

  if (body?.conversationId != null && conversationId == null) {
    return { code: 400, body: { error: "conversationId must be numeric when provided" } };
  }

  if (conversationId != null) {
    const conversation = engine.memory.db.prepare("SELECT id FROM conversations WHERE id = ? LIMIT 1").get(conversationId) as Record<string, unknown> | undefined;
    if (!conversation) {
      return { code: 404, body: { error: "conversation not found" } };
    }
  }

  const uploadBase = attachmentUploadsDir();
  await fs.promises.mkdir(uploadBase, { recursive: true });

  const size = contentBuffer.length;
  const sha256 = createHash("sha256").update(contentBuffer).digest("hex");
  const savedName = `${Date.now()}-${randomBytes(6).toString("hex")}-${filename}`;
  const filePath = path.join(uploadBase, savedName);
  const actorLabel = actor.trim().length > 0 ? actor.trim() : "daemon";

  appendAttachmentIngestEvent(
    eventLedger,
    "attachment.ingest.opened",
    `Local attachment ingest opened for ${filename}`,
    null,
    filename,
    contentType,
    size,
    conversationId,
    sha256,
    { routeLabel, actor: actorLabel },
  );
  appendAttachmentIngestEvent(
    eventLedger,
    "attachment.ingest.previewed",
    `Local attachment preview ready for ${filename}`,
    null,
    filename,
    contentType,
    size,
    conversationId,
    sha256,
    { routeLabel, actor: actorLabel, previewMode: "explicit-import" },
  );

  await fs.promises.writeFile(filePath, contentBuffer);

  const stmt = engine.memory.db.prepare(
    "INSERT INTO attachments (conversation_id, filename, path, content_type, size, sha256) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const info = stmt.run(conversationId, filename, filePath, contentType, size, sha256);
  const id = Number(info?.lastInsertRowid ?? 0);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("failed to insert attachment record");
  }

  try {
    engine.memory.db.prepare(
      "INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)"
    ).run(
      id,
      "upload",
      JSON.stringify({ filename, size, sha256, conversationId, routeLabel }),
      actorLabel,
    );
  } catch (error) {}

  appendAttachmentIngestEvent(
    eventLedger,
    "artifact.observed",
    `Observed local attachment ${filename}`,
    id,
    filename,
    contentType,
    size,
    conversationId,
    sha256,
    { routeLabel, actor: actorLabel },
  );
  appendAttachmentIngestEvent(
    eventLedger,
    "artifact.written",
    `Stored local attachment ${filename}`,
    id,
    filename,
    contentType,
    size,
    conversationId,
    sha256,
    { routeLabel, actor: actorLabel, path: filePath },
  );
  appendAttachmentIngestEvent(
    eventLedger,
    "attachment.ingest.completed",
    `Completed local attachment ingest for ${filename}`,
    id,
    filename,
    contentType,
    size,
    conversationId,
    sha256,
    { routeLabel, actor: actorLabel, path: filePath },
  );

  const row = engine.memory.db.prepare(
    "SELECT id, conversation_id, filename, path, content_type, size, sha256, created_at FROM attachments WHERE id = ?"
  ).get(id) as Record<string, unknown> | undefined;

  return {
    code: 200,
    body: {
      attachment: row ?? {
        id,
        conversation_id: conversationId,
        filename,
        path: filePath,
        content_type: contentType,
        size,
        sha256,
        created_at: new Date().toISOString(),
      },
    },
  };
}

function getWorkbenchContext() {
  const cwd = process.cwd();
  return {
    projectLabel: path.basename(path.resolve(cwd)) || "workspace",
    workDirLabel: path.join(".demo", "work"),
  };
}

function getWorkbenchOptions(
  ledger: InMemoryPrismEventLedger,
  approvalQueue: InMemoryApprovalQueue,
  currentSession: SpectraSession,
) {
  const ctx = getWorkbenchContext();
  return {
    projectLabel: ctx.projectLabel,
    workDirLabel: ctx.workDirLabel,
    daemonStatus: "healthy" as const,
    mode: "approvals-enabled" as const,
    eventLedger: ledger,
    approvalQueue,
    currentSession,
  };
}

function seedMockApprovalFixtures(approvalQueue: InMemoryApprovalQueue) {
  if (process.env.AI_FORGE_MOCK_EXECUTORS !== "1" || process.env.AI_FORGE_SEED_APPROVALS !== "1") {
    return;
  }

  approvalQueue.requestApproval({
    id: "mock-approval-preview",
    title: "Apply reviewed local fixture",
    summary: "Write the reviewed mock fixture into the isolated local work directory.",
    approvalClass: "write",
    checkpointPolicy: "before_write",
    relatedCapabilityId: "mock.fixture.write",
    relatedArtifactIds: ["mock-artifact-preview"],
    relatedFilePaths: [".demo/work/mock-preview.txt"],
    previewAvailable: true,
    previewSummary: "One local text fixture will be written after a checkpoint.",
    riskNotes: ["Changes local working state and can be reverted from the checkpoint."],
    localRemoteBoundary: "local-only",
    requestedBy: "mock-executor",
  });
  approvalQueue.requestApproval({
    id: "mock-approval-no-preview",
    title: "Run unpreviewed local fixture",
    summary: "Exercise the explicit no-preview approval treatment without an external call.",
    approvalClass: "write",
    checkpointPolicy: "before_write",
    relatedCapabilityId: "mock.fixture.unpreviewed",
    relatedArtifactIds: ["mock-artifact-no-preview"],
    relatedFilePaths: [".demo/work/mock-no-preview.txt"],
    previewAvailable: false,
    riskNotes: ["No preview was generated for this mock-only local write."],
    localRemoteBoundary: "local-only",
    requestedBy: "mock-executor",
  });
}

async function start() {
  const { engine, graphBuilder } = await initEngine();
  const currentSession = createCurrentSession(engine.memory, getWorkbenchContext().projectLabel);
  engine.setSessionId(currentSession.id);
  const eventLedger = new InMemoryPrismEventLedger({ sessionId: currentSession.id });
  const approvalQueue = new InMemoryApprovalQueue(eventLedger);
  seedMockApprovalFixtures(approvalQueue);
  const workbenchReloadHub = new WorkbenchReloadHub();
  const workbenchChangePipelineConfig = WORKBENCH_WATCH_ENABLED
    ? loadWorkbenchChangePipelineConfig(APP_PREVIEW_CONFIG_PATH)
    : { reloadOnValidationFailure: false };
  const workbenchWatcher = WORKBENCH_WATCH_ENABLED
    ? createWorkbenchWatcher({
        workbenchDir: WORKBENCH_DIR,
        onReload: () => {
          void handleWorkbenchChangePipeline({
            config: workbenchChangePipelineConfig,
            eventLedger,
            emitReload: () => workbenchReloadHub.emitReload(),
            workDir: process.cwd(),
          }).catch((error) => {
            console.warn("[daemon] Workbench change pipeline failed:", error);
          });
        },
      })
    : null;
  const appPreviewDirectories = APP_PREVIEW_ENABLED
    ? loadAppPreviewDirectories(APP_PREVIEW_CONFIG_PATH)
    : new Map<AppPreviewName, string>();
  const appPreviewPipelineConfigs = APP_PREVIEW_ENABLED
    ? loadAppPreviewChangePipelineConfigs(APP_PREVIEW_CONFIG_PATH)
    : new Map<AppPreviewName, WorkbenchChangePipelineConfig>();
  const appPreviews = createAppPreviews(appPreviewDirectories, {
    eventLedger,
    pipelineConfigs: appPreviewPipelineConfigs,
  });
  const runningAppPreviews = await startAppPreviewServers(appPreviews);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname.startsWith("/vendor/")) {
        return sendVendorFile(res, url.pathname);
      }

      if (req.method === "GET" && url.pathname.startsWith("/workbench-shims/")) {
        return sendWorkbenchShimFile(res, url.pathname);
      }

      if (req.method === "GET" && (url.pathname === "/workbench" || url.pathname === "/workbench/" || url.pathname === "/workbench/index.html")) {
        const html = await readWorkbenchHtml();
        return sendHtml(res, injectWorkbenchRuntime(html));
      }

      if (req.method === "GET" && url.pathname === "/api/v1/preview/apps") {
        if (runningAppPreviews.size === 0) {
          return jsonResponse(res, 404, { error: "not found" });
        }
        return jsonResponse(res, 200, {
          apps: [...runningAppPreviews].map(([app, item]) => ({
            app,
            url: item.url,
          })),
        });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/shell/mounts") {
        if (!SHELL_MOUNT_ENABLED) {
          return jsonResponse(res, 404, { error: "not found" });
        }
        return jsonResponse(res, 200, shellMounts(runningAppPreviews));
      }

      if (req.method === "GET" && url.pathname === "/api/v1/capabilities/manifests") {
        return jsonResponse(res, 200, { manifests: seedCapabilityManifests });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/roadmap") {
        try {
          return jsonResponse(res, 200, await readWorkbenchRoadmap());
        } catch (error) {
          return jsonResponse(res, 404, { error: "roadmap not found" });
        }
      }

      if (req.method === "GET" && url.pathname === "/api/v1/git/status") {
        return jsonResponse(res, 200, { repos: await listReadOnlyGitStatus(DAEMON_DIR) });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/ai/status") {
        return jsonResponse(res, 200, await readAiProviderStatus());
      }

      if (req.method === "GET" && url.pathname === "/api/v1/session/current") {
        return jsonResponse(res, 200, { session: currentSession });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/events") {
        if (wantsEventStream(req)) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });
          res.write(": connected\n\n");
          const unsubscribe = subscribeEventLedgerSse(eventLedger, (event) => {
            res.write(event);
          });
          req.once("close", unsubscribe);
          return;
        }
        const limit = Number(url.searchParams.get("limit") || 50);
        const events = eventLedger.list({ limit });
        const totalCount = eventLedger.list().length;
        return jsonResponse(res, 200, {
          events,
          count: events.length,
          totalCount,
        });
      }

      if (url.pathname === "/api/v1/workbench/live") {
        if (!WORKBENCH_WATCH_ENABLED) {
          return jsonResponse(res, 404, { error: "not found" });
        }
        if (req.method === "HEAD") {
          res.writeHead(204, {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          });
          return res.end();
        }
        if (req.method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });
          res.write(": connected\n\n");
          const unsubscribe = subscribeWorkbenchReloadSse(workbenchReloadHub, (event) => {
            res.write(event);
          });
          req.once("close", unsubscribe);
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/v1/approvals") {
        const approvals = approvalQueue.listApprovals();
        const pendingApprovals = approvalQueue.listApprovals({ status: "pending" });
        return jsonResponse(res, 200, {
          approvals,
          count: approvals.length,
          pendingCount: pendingApprovals.length,
          totalCount: approvals.length,
        });
      }

      const approvalResolveMatch = url.pathname.match(/^\/api\/v1\/approvals\/([^/]+)\/resolve$/);
      if (approvalResolveMatch && req.method === "POST") {
        const approvalId = decodeURIComponent(approvalResolveMatch[1]);
        const approval = approvalQueue.getApproval(approvalId);
        if (!approval) {
          return jsonResponse(res, 404, { error: "approval not found" });
        }
        if (approval.status !== "pending") {
          return jsonResponse(res, 409, { error: "approval is not pending" });
        }

        const body = await readBody(req);
        const status = body?.status;
        const decidedBy = typeof body?.decidedBy === "string" ? body.decidedBy.trim() : "";
        const reason = typeof body?.reason === "string" ? body.reason.trim() : undefined;
        const knownDecisionStatus = typeof status === "string"
          && approvalDecisionStatuses.includes(status as (typeof approvalDecisionStatuses)[number]);
        if (!knownDecisionStatus || (status !== "approved" && status !== "rejected") || !decidedBy) {
          return jsonResponse(res, 400, {
            error: 'expected { status: "approved" | "rejected", decidedBy, reason? }',
          });
        }
        if (body?.reason != null && typeof body.reason !== "string") {
          return jsonResponse(res, 400, { error: "reason must be a string when provided" });
        }

        const updated = approvalQueue.resolveApproval(approvalId, {
          status,
          decidedAt: new Date().toISOString(),
          decidedBy,
          ...(reason ? { reason } : {}),
        });
        return jsonResponse(res, 200, { approval: updated });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/workbench/resume") {
        return jsonResponse(res, 200, {
          resume: buildWorkbenchResume(engine.memory, getWorkbenchOptions(eventLedger, approvalQueue, currentSession)),
        });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/workbench/approvals") {
        return jsonResponse(res, 200, { approvals: buildWorkbenchApprovals(getWorkbenchOptions(eventLedger, approvalQueue, currentSession)) });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/workbench/changes") {
        const changesLimit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
        return jsonResponse(res, 200, { changes: buildWorkbenchChanges(engine.memory, getWorkbenchOptions(eventLedger, approvalQueue, currentSession), changesLimit) });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/workbench/conversations") {
        const limit = Number(url.searchParams.get("limit") || 25);
        return jsonResponse(res, 200, { conversations: listWorkbenchConversations(engine.memory, limit) });
      }

      const workbenchConversationMatch = url.pathname.match(/^\/api\/v1\/workbench\/conversations\/(\d+)$/);
      if (workbenchConversationMatch && req.method === "GET") {
        const conversationId = Number(workbenchConversationMatch[1]);
        const conversation = getWorkbenchConversation(engine.memory, conversationId);
        if (!conversation) return jsonResponse(res, 404, { error: "conversation not found" });
        return jsonResponse(res, 200, { conversation });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/workbench/attachments") {
        const limit = Number(url.searchParams.get("limit") || 25);
        return jsonResponse(res, 200, { attachments: listWorkbenchAttachments(engine.memory, limit, eventLedger) });
      }

      const workbenchAttachmentPreviewMatch = url.pathname.match(/^\/api\/v1\/workbench\/attachments\/(\d+)\/preview$/);
      if (workbenchAttachmentPreviewMatch && req.method === "GET") {
        const attachmentId = Number(workbenchAttachmentPreviewMatch[1]);
        return sendWorkbenchAttachmentPreview(res, engine, eventLedger, attachmentId);
      }

      const workbenchAttachmentMatch = url.pathname.match(/^\/api\/v1\/workbench\/attachments\/(\d+)$/);
      if (workbenchAttachmentMatch && req.method === "GET") {
        const attachmentId = Number(workbenchAttachmentMatch[1]);
        const attachment = getWorkbenchAttachment(engine.memory, attachmentId, eventLedger);
        if (!attachment) return jsonResponse(res, 404, { error: "attachment not found" });
        return jsonResponse(res, 200, { attachment });
      }

      const workbenchAttachmentUpdateMatch = url.pathname.match(/^\/api\/v1\/workbench\/attachments\/(\d+)$/);
      if (workbenchAttachmentUpdateMatch && req.method === "PATCH") {
        const attachmentId = Number(workbenchAttachmentUpdateMatch[1]);
        const body = await readBody(req);
        const actor = String(req.headers["x-local-token"] || "workbench").trim() || "workbench";
        if (body?.displayName == null) {
          return jsonResponse(res, 400, { error: "expected { displayName }" });
        }
        const result = updateAttachmentDisplayName(engine, eventLedger, attachmentId, body.displayName, actor);
        return jsonResponse(res, result.code, result.body);
      }

      const workbenchAttachmentTagAddMatch = url.pathname.match(/^\/api\/v1\/workbench\/attachments\/(\d+)\/tags$/);
      if (workbenchAttachmentTagAddMatch && req.method === "POST") {
        const attachmentId = Number(workbenchAttachmentTagAddMatch[1]);
        const body = await readBody(req);
        const actor = String(req.headers["x-local-token"] || "workbench").trim() || "workbench";
        const result = addAttachmentTag(engine, eventLedger, attachmentId, body?.tag, actor);
        return jsonResponse(res, result.code, result.body);
      }

      const workbenchAttachmentTagRemoveMatch = url.pathname.match(/^\/api\/v1\/workbench\/attachments\/(\d+)\/tags\/(.+)$/);
      if (workbenchAttachmentTagRemoveMatch && req.method === "DELETE") {
        const attachmentId = Number(workbenchAttachmentTagRemoveMatch[1]);
        const actor = String(req.headers["x-local-token"] || "workbench").trim() || "workbench";
        const tag = decodeURIComponent(workbenchAttachmentTagRemoveMatch[2] || "");
        const result = removeAttachmentTag(engine, eventLedger, attachmentId, tag, actor);
        return jsonResponse(res, result.code, result.body);
      }

      if (req.method === "POST" && url.pathname === "/api/v1/workbench/attachments/import-local") {
        const body = await readBody(req);
        const result = await importLocalAttachmentFromBody(engine, eventLedger, body, "workbench", "workbench-import-local");
        return jsonResponse(res, result.code, result.body);
      }

      if (!url.pathname.startsWith("/api/v1/")) return jsonResponse(res, 404, { error: "not found" });

      // CORS preflight support for browser-based POC clients
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "x-local-token,content-type",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        });
        return res.end();
      }

      // simple token auth for POC
      const provided = req.headers["x-local-token"];
      if (provided !== TOKEN) return unauthorized(res);

      if (req.method === "GET" && url.pathname === "/api/v1/health") {
        return jsonResponse(res, 200, { ok: true, available: true, cloudTeacherProviders: await checkAllCloudTeacherHealth() });
      }

      if (req.method === "POST" && url.pathname === "/api/v1/ai/request") {
        if (!isLoopbackRequest(req)) {
          return jsonResponse(res, 403, { ok: false, error: "ai request endpoint is loopback-only" });
        }
        const body = await readBody(req);
        const validation = normalizeAiRequestBody(body);
        if (!validation.ok) return jsonResponse(res, 400, { ok: false, error: validation.error });
        const result = await engine.runAiRequest(validation.request);
        return jsonResponse(res, result.ok ? 200 : 500, result);
      }

      if (req.method === "POST" && url.pathname === "/api/v1/build-graph") {
        const body = await readBody(req);
        if (!body || !body.graphId || !body.projectId || !body.description) {
          return jsonResponse(res, 400, { error: "expected {graphId, projectId, description, mode?}" });
        }
        const outcome = await graphBuilder.build({ graphId: body.graphId, projectId: body.projectId, description: body.description, mode: body.mode });
        // serialize TaskGraph minimally
        const nodes = outcome.graph.all().map((n) => ({ id: n.id, status: n.status, packet: n.packet }));
        return jsonResponse(res, 200, { source: outcome.source, fallbackReason: outcome.fallbackReason, failureNotesUsed: outcome.failureNotesUsed, graph: { id: outcome.graph.id, projectId: outcome.graph.projectId, nodes } });
      }

      if (req.method === "POST" && url.pathname === "/api/v1/route") {
        const body = await readBody(req);
        if (!body || !body.packet) return jsonResponse(res, 400, { error: "expected {packet}" });
        const decision = engine.router.route(body.packet);
        return jsonResponse(res, 200, decision);
      }

      if (req.method === "POST" && url.pathname === "/api/v1/execute-graph") {
        const body = await readBody(req);
        if (!body || !body.graph) return jsonResponse(res, 400, { error: "expected {graph, mode?}" });

        // Reconstruct TaskGraph from serialized nodes
        try {
          const inputs = (body.graph.nodes || []).map((n: any) => ({ id: n.id, packet: n.packet }));
          const tg = new TaskGraph(body.graph.id || `g-${Date.now()}`, body.graph.projectId || "dashboard", inputs);

          // Start SSE-like streaming over a chunked response (JSON objects separated by \n\n)
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });

          const send = (obj: unknown) => {
            try {
              res.write(JSON.stringify(obj) + "\n\n");
            } catch (e) {
              // client likely disconnected
            }
          };

          send({ type: "start", graphId: tg.id });

          // Track last-seen statuses so we only push deltas
          const lastStatuses = new Map<string, string>();
          for (const n of tg.all()) lastStatuses.set(n.id, n.status);

          const poll = setInterval(() => {
            try {
              for (const n of tg.all()) {
                const prev = lastStatuses.get(n.id);
                if (prev !== n.status) {
                  lastStatuses.set(n.id, n.status);
                  send({ type: "node", nodeId: n.id, status: n.status, packet: n.packet, result: n.result ?? null });
                }
              }
              // heartbeat
              send({ type: "heartbeat", ts: Date.now() });
            } catch (err) {
              console.error('stream poll error', err);
            }
          }, 300);

          // Run the engine against the TaskGraph; stream progress via the poll above.
          engine
            .run(tg, body.mode || "sequential")
            .then((logs) => {
              clearInterval(poll);
              // final snapshot
              for (const n of tg.all()) {
                send({ type: "node", nodeId: n.id, status: n.status, packet: n.packet, result: n.result ?? null });
              }
              send({ type: "done", logs });
              try {
                res.end();
              } catch (e) {}
            })
            .catch((err) => {
              clearInterval(poll);
              send({ type: "error", error: String(err) });
              try { res.end(); } catch (e) {}
            });

          // If the client disconnects, stop polling (engine will continue running server-side)
          req.on("close", () => {
            clearInterval(poll);
          });

          return;
        } catch (err: any) {
          return jsonResponse(res, 500, { error: `could not reconstruct graph: ${err?.message ?? String(err)}` });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/v1/preview-node") {
        const body = await readBody(req);
        if (!body || !body.graph || !body.nodeId) return jsonResponse(res, 400, { error: "expected {graph, nodeId, options?}" });
        // Run the supplied graph in an isolated temp workdir so we can capture the
        // checkpoint diff for the requested node without touching the real project.
        const tmpBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), "aiforge-preview-"));
        const tmpDb = path.join(tmpBase, "preview.db");
        const tmpWork = path.join(tmpBase, "work");
        await fs.promises.mkdir(tmpWork, { recursive: true });
        // Safe-by-default: use mock executors unless explicitly opting into real preview.
        // Real preview requires explicit opt-in via realPreview: true to prevent
        // accidental API calls and side effects. WARNING: real preview makes
        // actual API calls and may incur costs.
        const useMock = !(body.options && body.options.realPreview === true);
        const eng = new ExecutionEngine({ dbPath: tmpDb, workDir: tmpWork, mockExecutors: useMock, fallbackOnFailure: false });
        try {
          await eng.init();
          // Reconstruct the full TaskGraph from the serialized nodes
          const inputs = (body.graph.nodes || []).map((n: any) => ({ id: n.id, packet: n.packet }));
          const tg = new TaskGraph(body.graph.id || `preview-${Date.now()}`, body.graph.projectId || "preview", inputs);
          // Run the engine (will checkpoint each node into the temp repo). This
          // is intentionally a full run so dependencies are satisfied and the
          // requested node's checkpoint reflects real execution in context.
          const logs = await eng.run(tg, body.mode || "sequential");
          // Grab the git show diff for the requested node
          let diff = null;
          try {
            diff = await eng.checkpoints.diff(body.nodeId);
          } catch (err: any) {
            diff = null;
          }
          // Close DB before removing directory
          eng.close();
          // Read logs + diff and return
          const out = { diff: diff || '', logs: logs || [] };
          // Cleanup temp dir
          try { await fs.promises.rm(tmpBase, { recursive: true, force: true }); } catch (e) {}
          return jsonResponse(res, 200, out);
        } catch (err: any) {
          try { eng.close(); } catch (e) {}
          try { await fs.promises.rm(tmpBase, { recursive: true, force: true }); } catch (e) {}
          return jsonResponse(res, 500, { error: String(err?.message ?? err) });
        }
      }

      // Conversations endpoints: create/list conversations and post/get messages
      if (url.pathname === "/api/v1/conversations") {
        if (req.method === "POST") {
          const body = await readBody(req);
          const title = body?.title || null;
          const metadata = body?.metadata ? JSON.stringify(body.metadata) : null;
          const stmt = engine.memory.db.prepare(`INSERT INTO conversations (title, metadata) VALUES (?, ?)`);
          const info = stmt.run(title, metadata);
          const id = info?.lastInsertRowid ?? null;
          return jsonResponse(res, 200, { id, title });
        }
        if (req.method === "GET") {
          const rows = engine.memory.db.prepare(`SELECT id, title, metadata, created_at FROM conversations ORDER BY created_at DESC`).all();
          return jsonResponse(res, 200, { conversations: rows });
        }
      }

      // Upload attachment (base64 in JSON). Returns attachment id and metadata.
      if (req.method === 'POST' && url.pathname === '/api/v1/upload') {
        const body = await readBody(req);
        const result = await importLocalAttachmentFromBody(engine, eventLedger, body, String(req.headers["x-local-token"] || "daemon"), "legacy-upload");
        return jsonResponse(res, result.code, result.body);
      }

      // Download attachment bytes: /api/v1/download/:id
      const downloadMatch = url.pathname.match(/^\/api\/v1\/download\/(\d+)$/);
      if (downloadMatch && req.method === 'GET') {
        const attId = Number(downloadMatch[1]);
        const row = engine.memory.db.prepare('SELECT id, filename, path, content_type, size FROM attachments WHERE id = ?').get(attId);
        if (!row) return jsonResponse(res, 404, { error: 'attachment not found' });
        try {
          const stat = await fs.promises.stat(row.path);
          const rawFilename = String(row.filename || 'download');
          const fallbackFilename = rawFilename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
          const encodedFilename = encodeURIComponent(rawFilename)
            .replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
            .replace(/\*/g, '%2A');
          res.writeHead(200, {
            'Content-Type': row.content_type || 'application/octet-stream',
            'Content-Length': String(stat.size),
            'Content-Disposition': `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
            'Access-Control-Allow-Origin': '*',
          });
          const stream = fs.createReadStream(row.path);
          stream.pipe(res);
          return;
        } catch (e) {
          return jsonResponse(res, 500, { error: 'could not read file' });
        }
      }

      // Attachment metadata: /api/v1/attachments/:id/meta
      const metaMatch = url.pathname.match(/^\/api\/v1\/attachments\/(\d+)\/meta$/);
      if (metaMatch && req.method === 'GET') {
        const attId = Number(metaMatch[1]);
        const row = engine.memory.db.prepare('SELECT id, conversation_id, filename, content_type, size, created_at FROM attachments WHERE id = ?').get(attId);
        if (!row) return jsonResponse(res, 404, { error: 'attachment not found' });
        return jsonResponse(res, 200, { attachment: row });
      }

      // List attachments for a conversation: /api/v1/conversations/:id/attachments
      const convAttMatch = url.pathname.match(/^\/api\/v1\/conversations\/(\d+)\/attachments$/);
      if (convAttMatch && req.method === 'GET') {
        const convId = Number(convAttMatch[1]);
        const rows = engine.memory.db.prepare('SELECT id, filename, content_type, size, created_at FROM attachments WHERE conversation_id = ? ORDER BY created_at ASC').all(convId);
        return jsonResponse(res, 200, { attachments: rows });
      }

      // List all attachments: /api/v1/attachments
      if (req.method === 'GET' && url.pathname === '/api/v1/attachments') {
        const rows = engine.memory.db.prepare('SELECT id, conversation_id, filename, content_type, size, created_at FROM attachments ORDER BY created_at DESC').all();
        const tagStmt = engine.memory.db.prepare('SELECT tag FROM attachment_tags WHERE attachment_id = ? ORDER BY created_at ASC');
        const out = rows.map((r: any) => {
          const tags = (tagStmt.all(r.id) || []).map((t: any) => t.tag);
          return { ...r, tags };
        });
        return jsonResponse(res, 200, { attachments: out });
      }

      // Attachment tags: add -> POST /api/v1/attachments/:id/tags
      const addTagMatch = url.pathname.match(/^\/api\/v1\/attachments\/(\d+)\/tags$/);
      if (addTagMatch && req.method === 'POST') {
        const attId = Number(addTagMatch[1]);
        const body = await readBody(req);
        const result = addAttachmentTag(engine, eventLedger, attId, body?.tag, String(req.headers['x-local-token'] || 'daemon'));
        return jsonResponse(res, result.code, result.body);
      }

      // Remove a tag: DELETE /api/v1/attachments/:id/tags/:tag
      const delTagMatch = url.pathname.match(/^\/api\/v1\/attachments\/(\d+)\/tags\/(.+)$/);
      if (delTagMatch && req.method === 'DELETE') {
        const attId = Number(delTagMatch[1]);
        const tagRaw = delTagMatch[2] || '';
        const tag = decodeURIComponent(tagRaw);
        const result = removeAttachmentTag(engine, eventLedger, attId, tag, String(req.headers['x-local-token'] || 'daemon'));
        return jsonResponse(res, result.code, result.body);
      }

      // Rename attachment (metadata only): POST /api/v1/attachments/:id/rename
      const renameMatch = url.pathname.match(/^\/api\/v1\/attachments\/(\d+)\/rename$/);
      if (renameMatch && req.method === 'POST') {
        const attId = Number(renameMatch[1]);
        const body = await readBody(req);
        const result = updateAttachmentDisplayName(engine, eventLedger, attId, body?.filename, String(req.headers['x-local-token'] || 'daemon'));
        return jsonResponse(res, result.code, result.body);
      }

      // Delete attachment (removes file and DB row)
      const delMatch2 = url.pathname.match(/^\/api\/v1\/attachments\/(\d+)$/);
      if (delMatch2 && req.method === 'DELETE') {
        const attId = Number(delMatch2[1]);
        const row = engine.memory.db.prepare('SELECT id, path FROM attachments WHERE id = ?').get(attId);
        if (!row) return jsonResponse(res, 404, { error: 'attachment not found' });
        const uploadBase = process.env.AI_FORGE_UPLOADS_DIR || path.join(process.cwd(), 'uploads');
        const resolved = path.resolve(row.path);
        if (!resolved.startsWith(path.resolve(uploadBase))) return jsonResponse(res, 400, { error: 'invalid path' });
        try {
          // audit before deleting
          engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(attId, 'delete', JSON.stringify({ path: row.path }), req.headers['x-local-token'] || 'daemon');
        } catch (e) {}
        try { await fs.promises.unlink(row.path).catch(()=>{}); } catch (e) {}
        engine.memory.db.prepare('DELETE FROM attachments WHERE id = ?').run(attId);
        return jsonResponse(res, 200, { id: attId, deleted: true });
      }

      // Move (physically rename) attachment within uploads dir: POST /api/v1/attachments/:id/move { destName }
      const moveMatch = url.pathname.match(/^\/api\/v1\/attachments\/(\d+)\/move$/);
      if (moveMatch && req.method === 'POST') {
        const attId = Number(moveMatch[1]);
        const body = await readBody(req);
        const destName = body?.destName || body?.filename || null;
        if (!destName) return jsonResponse(res, 400, { error: 'expected { destName }' });
        const row = engine.memory.db.prepare('SELECT id, filename, path FROM attachments WHERE id = ?').get(attId);
        if (!row) return jsonResponse(res, 404, { error: 'attachment not found' });
        const uploadBase = process.env.AI_FORGE_UPLOADS_DIR || path.join(process.cwd(), 'uploads');
        const safeName = String(destName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const newSavedName = `${Date.now()}-${randomBytes(6).toString('hex')}-${safeName}`;
        const newPath = path.join(uploadBase, newSavedName);
        try {
          await fs.promises.mkdir(uploadBase, { recursive: true });
          await fs.promises.rename(row.path, newPath);
        } catch (err: any) {
          return jsonResponse(res, 500, { error: 'move failed: ' + String(err) });
        }
        // verify original path safety
        const resolvedOld = path.resolve(row.path);
        if (!resolvedOld.startsWith(path.resolve(uploadBase))) return jsonResponse(res, 400, { error: 'invalid original path' });
        engine.memory.db.prepare('UPDATE attachments SET filename = ?, path = ? WHERE id = ?').run(destName, newPath, attId);
        const updated = engine.memory.db.prepare('SELECT id, conversation_id, filename, path, content_type, size, created_at FROM attachments WHERE id = ?').get(attId);
        const tags = (engine.memory.db.prepare('SELECT tag FROM attachment_tags WHERE attachment_id = ? ORDER BY created_at ASC').all(attId) || []).map((t:any)=>t.tag);
        try {
          engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(attId, 'move', JSON.stringify({ from: row.path, to: newPath }), req.headers['x-local-token'] || 'daemon');
        } catch (e) {}
        return jsonResponse(res, 200, { attachment: { ...updated, tags } });
      }

      // Compare two attachments: POST /api/v1/attachments/compare { idA, idB }
      if (req.method === 'POST' && url.pathname === '/api/v1/attachments/compare') {
        const body = await readBody(req);
        const idA = Number(body?.idA || body?.a);
        const idB = Number(body?.idB || body?.b);
        if (!idA || !idB) return jsonResponse(res, 400, { error: 'expected { idA, idB }' });
        const a = engine.memory.db.prepare('SELECT id, filename, path FROM attachments WHERE id = ?').get(idA);
        const b = engine.memory.db.prepare('SELECT id, filename, path FROM attachments WHERE id = ?').get(idB);
        if (!a || !b) return jsonResponse(res, 404, { error: 'one or both attachments not found' });
        try {
          // Audit the compare request
          try { engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(idA, 'compare', JSON.stringify({ other: idB }), req.headers['x-local-token'] || 'daemon'); } catch (e) {}
          // Use git diff --no-index for a unified diff between arbitrary files
          const args = ['--no-pager','diff','--no-index','-U3', a.path, b.path];
          const out = await new Promise<string>((resolve) => {
            cp.execFile('git', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
              resolve((stdout || stderr || '').toString());
            });
          });
          return jsonResponse(res, 200, { diff: out });
        } catch (err: any) {
          return jsonResponse(res, 500, { error: String(err) });
        }
      }

        // List checkpoints: GET /api/v1/checkpoints?limit=100
        if (req.method === 'GET' && url.pathname === '/api/v1/checkpoints') {
          const limit = Number(url.searchParams.get('limit') || 200);
          const rows = engine.memory.db.prepare('SELECT id, project_id, graph_id, node_id, sha, had_changes, rolled_back, created_at, rolled_back_at, session_id FROM checkpoints ORDER BY created_at DESC LIMIT ?').all(limit);
          return jsonResponse(res, 200, { checkpoints: rows });
        }

        // Checkpoint meta by nodeId: GET /api/v1/checkpoints/:nodeId
        const cpMatch = url.pathname.match(/^\/api\/v1\/checkpoints\/(.+)$/);
        if (cpMatch && req.method === 'GET') {
          const nodeId = decodeURIComponent(cpMatch[1]);
          const row = engine.memory.db.prepare('SELECT id, project_id, graph_id, node_id, sha, had_changes, rolled_back, created_at, rolled_back_at, session_id FROM checkpoints WHERE node_id = ? ORDER BY created_at DESC LIMIT 1').get(nodeId);
          if (!row) return jsonResponse(res, 404, { error: 'checkpoint not found' });
          return jsonResponse(res, 200, { checkpoint: row });
        }

        // Roll back a node's checkpoint: POST /api/v1/nodes/:nodeId/rollback
        const rbMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)\/rollback$/);
        if (rbMatch && req.method === 'POST') {
          const nodeId = decodeURIComponent(rbMatch[1]);
          let newSha = null;
          try {
            // Prefer manager's in-memory rollback if available
            try {
              newSha = await engine.checkpoints.rollback(nodeId);
            } catch (err: any) {
              // If manager doesn't know this nodeId (e.g. after restart), fall back
              // to persisted checkpoint SHA from DB and call rollback by sha.
              const row = engine.memory.db.prepare('SELECT id, project_id, graph_id, node_id, sha FROM checkpoints WHERE node_id = ? ORDER BY created_at DESC LIMIT 1').get(nodeId);
              if (!row) throw err;
              newSha = await engine.checkpoints.rollbackSha(row.sha, nodeId).catch((e)=>{ throw e; });
              // mark as rolled back
              try { engine.memory.db.prepare('UPDATE checkpoints SET rolled_back = 1, rolled_back_at = datetime(\'now\') WHERE id = ?').run(row.id); } catch (e) {}
              try { engine.memory.db.prepare('INSERT INTO audit_log (scope, object_id, action, details, actor) VALUES (?, ?, ?, ?, ?)').run('node', nodeId, 'rollback', JSON.stringify({ projectId: row.project_id, graphId: row.graph_id, sha: row.sha, newSha }), req.headers['x-local-token'] || 'daemon'); } catch (e) {}
            }
            // mark persisted checkpoint row as rolled back (if present) and audit
            try {
              const row2 = engine.memory.db.prepare('SELECT id, project_id, graph_id, node_id, sha FROM checkpoints WHERE node_id = ? ORDER BY created_at DESC LIMIT 1').get(nodeId);
              if (row2) {
                engine.memory.db.prepare('UPDATE checkpoints SET rolled_back = 1, rolled_back_at = datetime(\'now\') WHERE id = ?').run(row2.id);
                try { engine.memory.db.prepare('INSERT INTO audit_log (scope, object_id, action, details, actor) VALUES (?, ?, ?, ?, ?)').run('node', nodeId, 'rollback', JSON.stringify({ projectId: row2.project_id, graphId: row2.graph_id, sha: row2.sha, newSha }), req.headers['x-local-token'] || 'daemon'); } catch (e) {}
              } else {
                try { engine.memory.db.prepare('INSERT INTO audit_log (scope, object_id, action, details, actor) VALUES (?, ?, ?, ?, ?)').run('node', nodeId, 'rollback', JSON.stringify({ sha: newSha }), req.headers['x-local-token'] || 'daemon'); } catch (e) {}
              }
            } catch (e) {}
            return jsonResponse(res, 200, { ok: true, sha: newSha });
          } catch (err: any) {
            return jsonResponse(res, 500, { error: String(err?.message ?? err) });
          }
        }

      // Repair an attachment (preview/apply): POST /api/v1/attachments/:id/repair { apply? }
      const repairMatch = url.pathname.match(/^\/api\/v1\/attachments\/(\d+)\/repair$/);
      if (repairMatch && req.method === 'POST') {
        const attId = Number(repairMatch[1]);
        const body = await readBody(req);
        const apply = !!body?.apply;
        const row = engine.memory.db.prepare('SELECT id, filename, path, content_type, sha256 FROM attachments WHERE id = ?').get(attId);
        if (!row) return jsonResponse(res, 404, { error: 'attachment not found' });
        // Read original content
        let orig = null;
        try { orig = await fs.promises.readFile(row.path, 'utf8'); } catch (e) { return jsonResponse(res, 500, { error: 'could not read file' }); }

        // Generate repaired content based on heuristics
        let repaired = orig;
        const fname = String(row.filename || '').toLowerCase();
        const ctype = String(row.content_type || '').toLowerCase();
        try {
          if (ctype.includes('json') || fname.endsWith('.json')) {
            // attempt to parse and reformat JSON
            const parsed = JSON.parse(orig);
            repaired = JSON.stringify(parsed, null, 2) + '\n';
          } else if (/\.(js|ts|jsx|tsx|css|html|md|txt)$/.test(fname) || ctype.startsWith('text/')) {
            // normalize line endings and trim trailing whitespace
            repaired = orig.replace(/\r\n/g,'\n').split('\n').map(l=>l.replace(/[ \t]+$/,'')).join('\n');
            if (!repaired.endsWith('\n')) repaired += '\n';
          } else {
            // binary / unsupported — no-op
            repaired = orig;
          }
        } catch (err:any) {
          // on error, return parse failure for preview
          return jsonResponse(res, 500, { error: 'repair failed: ' + String(err) });
        }

        // If no changes, return empty diff (and audit preview)
        if (repaired === orig && !apply) {
          try { engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(attId, 'repair_preview', JSON.stringify({ oldSha: row.sha256 || null }), req.headers['x-local-token'] || 'daemon'); } catch (e) {}
          return jsonResponse(res, 200, { diff: '' });
        }

        // Write repaired content to temp file and produce a diff
        const tmpBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aiforge-repair-'));
        const tmpPath = path.join(tmpBase, String(path.basename(row.path)));
        await fs.promises.writeFile(tmpPath, repaired, 'utf8');
        const diffOut = await new Promise<string>((resolve) => {
          cp.execFile('git', ['--no-pager','diff','--no-index','-U3', row.path, tmpPath], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve((stdout || stderr || '').toString());
          });
        });

        if (apply) {
          try {
            await fs.promises.copyFile(tmpPath, row.path);
            // update DB size
            const stat = await fs.promises.stat(row.path);
            // compute new sha
            let newSha = null;
            try {
              const b = await fs.promises.readFile(row.path);
              newSha = createHash('sha256').update(b).digest('hex');
            } catch (e) { newSha = null; }
            engine.memory.db.prepare('UPDATE attachments SET size = ?, sha256 = ? WHERE id = ?').run(stat.size, newSha, attId);
            try { engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(attId, 'repair_apply', JSON.stringify({ oldSha: row.sha256 || null, newSha }), req.headers['x-local-token'] || 'daemon'); } catch (e) {}
          } catch (err:any) {
            try { await fs.promises.rm(tmpBase, { recursive: true, force: true }); } catch (e) {}
            return jsonResponse(res, 500, { error: 'apply failed: ' + String(err) });
          }
          try { await fs.promises.rm(tmpBase, { recursive: true, force: true }); } catch (e) {}
          return jsonResponse(res, 200, { applied: true, diff: diffOut });
        }

        // audit preview
        try { engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(attId, 'repair_preview', JSON.stringify({ oldSha: row.sha256 || null }), req.headers['x-local-token'] || 'daemon'); } catch (e) {}
        // Cleanup temp dir and return preview diff
        try { await fs.promises.rm(tmpBase, { recursive: true, force: true }); } catch (e) {}
        return jsonResponse(res, 200, { diff: diffOut });
      }

      // messages list / create: /api/v1/conversations/:id/messages
      const convMsgMatch = url.pathname.match(/^\/api\/v1\/conversations\/(\d+)\/messages$/);
      if (convMsgMatch) {
        const convId = Number(convMsgMatch[1]);
        if (req.method === "GET") {
          const rows = engine.memory.db.prepare(`SELECT id, conversation_id, role, provider, model, prompt, response, response_sha, attachments, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC`).all(convId);
          return jsonResponse(res, 200, { messages: rows });
        }
        if (req.method === "POST") {
          const body = await readBody(req);
          const role = body?.role || 'user';
          const provider = body?.provider || null;
          const model = body?.model || null;
          const prompt = body?.prompt || null;
          const response = body?.response || null;
          const response_sha = body?.response_sha || null;
          const attachments = body?.attachments ? JSON.stringify(body.attachments) : null;
          const stmt = engine.memory.db.prepare(`INSERT INTO messages (conversation_id, role, provider, model, prompt, response, response_sha, attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
          const info = stmt.run(convId, role, provider, model, prompt, response, response_sha, attachments);
          return jsonResponse(res, 200, { id: info?.lastInsertRowid ?? null });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/v1/execute-node") {
        const body = await readBody(req);
        if (!body || !body.graph || !body.nodeId) return jsonResponse(res, 400, { error: "expected {graph, nodeId, mode?}" });

        // Run the supplied graph against the daemon's real workDir so the
        // requested node's patch is applied to the actual project and
        // checkpointed. The daemon process's cwd is used by default but can
        // be overridden with AI_FORGE_DAEMON_REAL_WORKDIR env var.
        const realWorkDir = process.env.AI_FORGE_DAEMON_REAL_WORKDIR || process.cwd();
        const dbFile = path.join(realWorkDir, `.aiforge-daemon-${process.pid}.db`);

        const eng = new ExecutionEngine({ dbPath: dbFile, workDir: realWorkDir, mockExecutors: false, fallbackOnFailure: false });
        try {
          await eng.init();
          const inputs = (body.graph.nodes || []).map((n: any) => ({ id: n.id, packet: n.packet }));
          const tg = new TaskGraph(body.graph.id || `apply-${Date.now()}`, body.graph.projectId || "project", inputs);

          // Run the graph (this will checkpoint commits into the real repo).
          const logs = await eng.run(tg, body.mode || "sequential");
          // Grab the git show diff for the requested node
          let diff = null;
          try { diff = await eng.checkpoints.diff(body.nodeId); } catch (err: any) { diff = null; }
          eng.close();
          return jsonResponse(res, 200, { diff: diff || '', logs: logs || [] });
        } catch (err: any) {
          try { eng.close(); } catch (e) {}
          return jsonResponse(res, 500, { error: String(err?.message ?? err) });
        }
      }

      // fallback: not implemented endpoints
      return jsonResponse(res, 404, { error: "endpoint not implemented in POC" });
    } catch (err: any) {
      console.error("daemon error:", err);
      return jsonResponse(res, 500, { error: err?.message ?? String(err) });
    }
  });
  server.once("close", () => {
    workbenchWatcher?.close();
    for (const item of runningAppPreviews.values()) item.server.close();
    for (const preview of appPreviews.values()) preview.watcher.close();
  });

  server.listen(PORT, HOST, () => {
    console.log(`AI-Forge POC daemon listening on http://${HOST}:${PORT}/api/v1`);
    console.log("Use header 'x-local-token' with token printed below to authenticate.");
    console.log("Token:", TOKEN);
    if (runningAppPreviews.size > 0) {
      console.log(
        `App previews: ${[...runningAppPreviews].map(([app, item]) => `${app}=${item.url}`).join(", ")}`,
      );
    } else if (APP_PREVIEW_ENABLED) {
      console.warn(
        `[daemon] AI_FORGE_APP_PREVIEW=1 but no app previews started — check ${APP_PREVIEW_CONFIG_PATH} (missing or empty; recreate from spectra.preview.example.json).`,
      );
    }
  });
}

start().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});
