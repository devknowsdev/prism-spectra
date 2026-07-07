// src/memory/db.ts
//
// Uses Node's built-in `node:sqlite` (stable enough for our needs as of Node 22;
// flagged experimental by Node itself, not by us). Chosen over better-sqlite3
// because that requires a native build step that pulls headers from
// nodejs.org, which this sandbox's egress allowlist blocks. No functional
// downside for this engine — single-writer, single-process, file-backed.
//
// Schema covers 06_MEMORY_SYSTEM.md's four stores:
//   - task history (per-project)
//   - execution logs (per-project, provider/tokens/cost/latency/success)
//   - cost/quota ledger (per-provider running totals vs RPM/RPD/$ ceilings)
//   - pattern cache (GLOBAL, cross-project — hash(task-type+context) -> output)
// Plus routing_weights, which is the persisted state of the learning loop (11)
// that Routing Engine v3 (03) reads — same mechanism, not a separate table set
// of independent meaning.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export class MemoryDB {
  readonly db: InstanceType<typeof DatabaseSync>;

  constructor(filePath: string) {
    const dir = path.dirname(filePath);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        graph_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        intent TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS execution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        graph_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        success INTEGER NOT NULL,
        error TEXT,
        data_boundary TEXT NOT NULL DEFAULT 'local', -- 'local' | 'remote_no_training' | 'remote_may_train' — see types.ts dataBoundaryFor()
        cache_hit INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS cost_quota_ledger (
        provider TEXT PRIMARY KEY,
        rpm_limit INTEGER,
        rpm_used INTEGER NOT NULL DEFAULT 0,
        rpm_reset_at TEXT,
        rpd_limit INTEGER,
        rpd_used INTEGER NOT NULL DEFAULT 0,
        rpd_reset_at TEXT,
        dollar_budget REAL,
        dollar_used REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Global, cross-project: NOT scoped by project_id (06).
      CREATE TABLE IF NOT EXISTS pattern_cache (
        cache_key TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        intent TEXT NOT NULL,
        output TEXT NOT NULL,
        origin_provider TEXT NOT NULL, -- provider that produced this output originally
        origin_tokens_in INTEGER NOT NULL DEFAULT 0,
        origin_tokens_out INTEGER NOT NULL DEFAULT 0,
        origin_patch TEXT, -- JSON-serialized Patch, if the original call wrote files
        hits INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_hit_at TEXT
      );

      -- Persisted learning-loop state (11) = Routing Engine v3 input (03).
      CREATE TABLE IF NOT EXISTS routing_weights (
        provider TEXT NOT NULL,
        node_type TEXT NOT NULL,
        samples INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        avg_cost REAL NOT NULL DEFAULT 0,
        avg_latency_ms REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (provider, node_type)
      );

      -- Conversations and messages for chat/history persistence (simple schema)
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        label TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        prompt TEXT,
        response TEXT,
        response_sha TEXT,
        attachments TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER,
        filename TEXT NOT NULL,
        path TEXT NOT NULL,
        content_type TEXT,
        size INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
      );

      -- Ensure attachments has a sha256 column for content fingerprints.
    `);

    // Add sha256 column if missing (safe on existing DBs)
    try {
      const cols = this.db.prepare("PRAGMA table_info('attachments')").all();
      const hasSha = Array.isArray(cols) && cols.some((c: any) => c.name === 'sha256');
      if (!hasSha) this.db.exec("ALTER TABLE attachments ADD COLUMN sha256 TEXT;");
    } catch (e) {
      // ignore migration errors — best-effort
    }

    // Optional tags for attachments (many tags per attachment)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS attachment_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attachment_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Audit log for attachment operations (keeps a record of uploads, moves, deletes, repairs)
      CREATE TABLE IF NOT EXISTS attachment_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attachment_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        actor TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Checkpoints recorded per-node so rollbacks can be targeted and queried
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        graph_id TEXT,
        node_id TEXT,
        sha TEXT NOT NULL,
        had_changes INTEGER NOT NULL DEFAULT 0,
        rolled_back INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        rolled_back_at TEXT
      );

      -- Generic audit log for system actions (nodes, attachments, user actions)
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT,
        object_id TEXT,
        action TEXT NOT NULL,
        details TEXT,
        actor TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    try {
      const cols = this.db.prepare("PRAGMA table_info('checkpoints')").all();
      const hasSessionId = Array.isArray(cols) && cols.some((c: any) => c.name === "session_id");
      if (!hasSessionId) this.db.exec("ALTER TABLE checkpoints ADD COLUMN session_id TEXT;");
    } catch (e) {
      // ignore migration errors — best-effort
    }
  }

  close(): void {
    this.db.close();
  }
}
