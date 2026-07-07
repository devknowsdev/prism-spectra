import { randomBytes } from "node:crypto";
import type { MemoryDB } from "../memory/db.js";

export interface SpectraSession {
  id: string;
  project: string;
  label: string | null;
  startedAt: string;
  endedAt: string | null;
}

function safeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function optionalText(value: unknown): string | null {
  const text = safeText(value, "");
  return text.length > 0 ? text : null;
}

function sessionFromRow(row: Record<string, unknown>): SpectraSession {
  return {
    id: safeText(row.id),
    project: safeText(row.project, "workspace"),
    label: optionalText(row.label),
    startedAt: safeText(row.started_at),
    endedAt: optionalText(row.ended_at),
  };
}

function createSessionId(): string {
  return `sess_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function createCurrentSession(
  db: MemoryDB,
  project: string,
  options: { id?: string; label?: string | null; startedAt?: string } = {},
): SpectraSession {
  const session: SpectraSession = {
    id: safeText(options.id, createSessionId()),
    project: safeText(project, "workspace"),
    label: optionalText(options.label),
    startedAt: safeText(options.startedAt, new Date().toISOString()),
    endedAt: null,
  };

  db.db.prepare(
    "INSERT INTO sessions (id, project, label, started_at, ended_at) VALUES (?, ?, ?, ?, NULL)",
  ).run(session.id, session.project, session.label, session.startedAt);

  return session;
}

export function getSessionById(db: MemoryDB, id: string): SpectraSession | null {
  const row = db.db.prepare(
    "SELECT id, project, label, started_at, ended_at FROM sessions WHERE id = ? LIMIT 1",
  ).get(id) as Record<string, unknown> | undefined;
  return row ? sessionFromRow(row) : null;
}
