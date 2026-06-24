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
  buildWorkbenchApprovals,
  buildWorkbenchChanges,
  buildWorkbenchResume,
  seedCapabilityManifests,
} from "../src/index.js";
import { TaskGraph } from "../src/taskGraph/graph.js";

const PORT = Number(process.env.AI_FORGE_DAEMON_PORT ?? 3000);
const HOST = process.env.AI_FORGE_DAEMON_HOST ?? "127.0.0.1";
const ENV_TOKEN = process.env.AI_FORGE_DAEMON_TOKEN ?? process.env.LOCAL_AI_TOKEN;
const TOKEN = ENV_TOKEN || randomBytes(18).toString("hex");
const DAEMON_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKBENCH_HTML_PATH = path.resolve(DAEMON_DIR, "../ui/workbench/index.html");

async function initEngine() {
  const engine = new ExecutionEngine({ dbPath: ".demo/daemon.db", workDir: ".demo/work", mockExecutors: true, fallbackOnFailure: false });
  await engine.init();
  const graphBuilder = new GraphBuilder(engine.memory, engine.taskHistory);
  return { engine, graphBuilder };
}

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

async function readWorkbenchHtml(): Promise<string> {
  return fs.promises.readFile(WORKBENCH_HTML_PATH, "utf-8");
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
) {
  const ctx = getWorkbenchContext();
  return {
    projectLabel: ctx.projectLabel,
    workDirLabel: ctx.workDirLabel,
    daemonStatus: "healthy" as const,
    mode: "read-only" as const,
    eventLedger: ledger,
    approvalQueue,
  };
}

async function start() {
  const { engine, graphBuilder } = await initEngine();
  const eventLedger = new InMemoryPrismEventLedger();
  const approvalQueue = new InMemoryApprovalQueue(eventLedger);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);

      if (req.method === "GET" && (url.pathname === "/workbench" || url.pathname === "/workbench/" || url.pathname === "/workbench/index.html")) {
        return sendHtml(res, await readWorkbenchHtml());
      }

      if (req.method === "GET" && url.pathname === "/api/v1/capabilities/manifests") {
        return jsonResponse(res, 200, { manifests: seedCapabilityManifests });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/events") {
        const limit = Number(url.searchParams.get("limit") || 50);
        const events = eventLedger.list({ limit });
        const totalCount = eventLedger.list().length;
        return jsonResponse(res, 200, {
          events,
          count: events.length,
          totalCount,
        });
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

      if (req.method === "GET" && url.pathname === "/api/v1/workbench/resume") {
        return jsonResponse(res, 200, {
          resume: buildWorkbenchResume(engine.memory, getWorkbenchOptions(eventLedger, approvalQueue)),
        });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/workbench/approvals") {
        return jsonResponse(res, 200, { approvals: buildWorkbenchApprovals(getWorkbenchOptions(eventLedger, approvalQueue)) });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/workbench/changes") {
        return jsonResponse(res, 200, { changes: buildWorkbenchChanges(engine.memory, getWorkbenchOptions(eventLedger, approvalQueue)) });
      }

      if (!url.pathname.startsWith("/api/v1/")) return jsonResponse(res, 404, { error: "not found" });

      // CORS preflight support for browser-based POC clients
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "x-local-token,content-type",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        });
        return res.end();
      }

      // simple token auth for POC
      const provided = req.headers["x-local-token"];
      if (provided !== TOKEN) return unauthorized(res);

      if (req.method === "GET" && url.pathname === "/api/v1/health") {
        return jsonResponse(res, 200, { ok: true, available: true });
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
        if (!body || !body.filename || !body.contentBase64) return jsonResponse(res, 400, { error: 'expected {filename, contentBase64, contentType?, conversationId?}' });
        const uploadBase = process.env.AI_FORGE_UPLOADS_DIR || path.join(process.cwd(), 'uploads');
        await fs.promises.mkdir(uploadBase, { recursive: true });
        const buffer = Buffer.from(body.contentBase64, 'base64');
        const maxBytes = Number(process.env.AI_FORGE_MAX_UPLOAD_BYTES || 20 * 1024 * 1024);
        if (buffer.length > maxBytes) return jsonResponse(res, 413, { error: 'file too large' });
        const safeName = String(body.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
        const savedName = `${Date.now()}-${randomBytes(6).toString('hex')}-${safeName}`;
        const filePath = path.join(uploadBase, savedName);

        // Sanitize filename for storage (prevent header injection)
        const MAX_FILENAME = 255;
        const originalFilename = String(body.filename || '').slice(0, MAX_FILENAME);
        const sanitizedFilename = originalFilename.replace(/\r/g, '').replace(/\n/g, '').replace(/"/g, '\\"');

        // compute sha256 fingerprint
        const sha = createHash('sha256').update(buffer).digest('hex');

        await fs.promises.writeFile(filePath, buffer);
        const convId = body.conversationId || null;
        const stmt = engine.memory.db.prepare(`INSERT INTO attachments (conversation_id, filename, path, content_type, size, sha256) VALUES (?, ?, ?, ?, ?, ?)`);
        const info = stmt.run(convId, sanitizedFilename, filePath, body.contentType || null, buffer.length, sha);
        const id = info?.lastInsertRowid ?? null;

        // audit
        try {
          engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(id, 'upload', JSON.stringify({ filename: sanitizedFilename, size: buffer.length, sha }), req.headers['x-local-token'] || 'daemon');
        } catch (e) {}

        return jsonResponse(res, 200, { id, filename: sanitizedFilename, size: buffer.length, contentType: body.contentType || null, sha256: sha });
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
        const tag = body?.tag ? String(body.tag).trim() : null;
        if (!tag) return jsonResponse(res, 400, { error: 'expected { tag }' });
        // avoid duplicates
        const exists = engine.memory.db.prepare('SELECT 1 FROM attachment_tags WHERE attachment_id = ? AND tag = ?').get(attId, tag);
        if (!exists) {
          engine.memory.db.prepare('INSERT INTO attachment_tags (attachment_id, tag) VALUES (?, ?)').run(attId, tag);
          try { engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(attId, 'tag_add', JSON.stringify({ tag }), req.headers['x-local-token'] || 'daemon'); } catch (e) {}
        }
        const tags = (engine.memory.db.prepare('SELECT tag FROM attachment_tags WHERE attachment_id = ? ORDER BY created_at ASC').all(attId) || []).map((t:any)=>t.tag);
        return jsonResponse(res, 200, { id: attId, tags });
      }

      // Remove a tag: DELETE /api/v1/attachments/:id/tags/:tag
      const delTagMatch = url.pathname.match(/^\/api\/v1\/attachments\/(\d+)\/tags\/(.+)$/);
      if (delTagMatch && req.method === 'DELETE') {
        const attId = Number(delTagMatch[1]);
        const tagRaw = delTagMatch[2] || '';
        const tag = decodeURIComponent(tagRaw);
        engine.memory.db.prepare('DELETE FROM attachment_tags WHERE attachment_id = ? AND tag = ?').run(attId, tag);
        try { engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(attId, 'tag_remove', JSON.stringify({ tag }), req.headers['x-local-token'] || 'daemon'); } catch (e) {}
        const tags = (engine.memory.db.prepare('SELECT tag FROM attachment_tags WHERE attachment_id = ? ORDER BY created_at ASC').all(attId) || []).map((t:any)=>t.tag);
        return jsonResponse(res, 200, { id: attId, tags });
      }

      // Rename attachment (metadata only): POST /api/v1/attachments/:id/rename
      const renameMatch = url.pathname.match(/^\/api\/v1\/attachments\/(\d+)\/rename$/);
      if (renameMatch && req.method === 'POST') {
        const attId = Number(renameMatch[1]);
        const body = await readBody(req);
        const filename = body?.filename ? String(body.filename).trim() : null;
        if (!filename) return jsonResponse(res, 400, { error: 'expected { filename }' });
        // Validate filename size and characters to prevent header injection
        const MAX_FILENAME = 255;
        if (filename.length > MAX_FILENAME) {
          return jsonResponse(res, 400, { error: 'filename too long (max 255 chars)' });
        }
        const sanitizedFilename = filename.replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '');
        const prev = engine.memory.db.prepare('SELECT filename FROM attachments WHERE id = ?').get(attId);
        engine.memory.db.prepare('UPDATE attachments SET filename = ? WHERE id = ?').run(sanitizedFilename, attId);
        const row = engine.memory.db.prepare('SELECT id, conversation_id, filename, content_type, size, created_at FROM attachments WHERE id = ?').get(attId);
        const tags = (engine.memory.db.prepare('SELECT tag FROM attachment_tags WHERE attachment_id = ? ORDER BY created_at ASC').all(attId) || []).map((t:any)=>t.tag);
        try {
          engine.memory.db.prepare('INSERT INTO attachment_audit (attachment_id, action, details, actor) VALUES (?, ?, ?, ?)').run(attId, 'rename', JSON.stringify({ from: prev?.filename || null, to: sanitizedFilename }), req.headers['x-local-token'] || 'daemon');
        } catch (e) {}
        return jsonResponse(res, 200, { attachment: { ...row, tags } });
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
          const rows = engine.memory.db.prepare('SELECT id, project_id, graph_id, node_id, sha, had_changes, rolled_back, created_at, rolled_back_at FROM checkpoints ORDER BY created_at DESC LIMIT ?').all(limit);
          return jsonResponse(res, 200, { checkpoints: rows });
        }

        // Checkpoint meta by nodeId: GET /api/v1/checkpoints/:nodeId
        const cpMatch = url.pathname.match(/^\/api\/v1\/checkpoints\/(.+)$/);
        if (cpMatch && req.method === 'GET') {
          const nodeId = decodeURIComponent(cpMatch[1]);
          const row = engine.memory.db.prepare('SELECT id, project_id, graph_id, node_id, sha, had_changes, rolled_back, created_at, rolled_back_at FROM checkpoints WHERE node_id = ? ORDER BY created_at DESC LIMIT 1').get(nodeId);
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

  server.listen(PORT, HOST, () => {
    console.log(`AI-Forge POC daemon listening on http://${HOST}:${PORT}/api/v1`);
    console.log("Use header 'x-local-token' with token printed below to authenticate.");
    console.log("Token:", TOKEN);
  });
}

start().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});
