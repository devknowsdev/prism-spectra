import type { MemoryDB } from "../memory/db.js";

export interface WorkbenchConversationMessage {
  id: number;
  conversationId: number;
  role: string;
  provider: string | null;
  model: string | null;
  prompt: string | null;
  response: string | null;
  responseSha: string | null;
  attachments: string[];
  createdAt: string;
}

export interface WorkbenchConversationAttachment {
  id: number;
  filename: string;
  path: string;
  contentType: string | null;
  size: number | null;
  tags: string[];
  createdAt: string;
}

export interface WorkbenchConversationSummary {
  id: number;
  label: string;
  title: string | null;
  summary: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  attachmentCount: number;
  relatedCheckpointId: number | null;
  relatedArtifactId: string | null;
}

export interface WorkbenchConversationDetail extends WorkbenchConversationSummary {
  metadata: Record<string, unknown> | null;
  messages: WorkbenchConversationMessage[];
  attachments: WorkbenchConversationAttachment[];
}

export interface WorkbenchConversationCollection {
  count: number;
  totalCount: number;
  items: WorkbenchConversationSummary[];
  emptyStateMessage: string;
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

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value ?? Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (err) {
    return null;
  }
  return null;
}

function parseAttachmentRefs(value: unknown): string[] {
  if (typeof value !== "string" || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          return safeText(record.filename ?? record.name ?? record.path ?? record.id, "");
        }
        return "";
      })
      .filter((entry) => entry.length > 0);
  } catch (err) {
    return [];
  }
}

function summarizeConversationMetadata(metadata: Record<string, unknown> | null): {
  relatedCheckpointId: number | null;
  relatedArtifactId: string | null;
  summary: string | null;
} {
  const relatedCheckpointCandidate = metadata?.relatedCheckpointId ?? metadata?.checkpointId;
  const relatedCheckpointId = typeof relatedCheckpointCandidate === "number" ? relatedCheckpointCandidate : null;
  const relatedArtifactId = optionalText(metadata?.relatedArtifactId ?? metadata?.artifactId);
  const summary = optionalText(metadata?.summary ?? metadata?.title ?? metadata?.label);
  return { relatedCheckpointId, relatedArtifactId, summary };
}

function summarizeConversationRow(row: Record<string, unknown>): WorkbenchConversationSummary {
  const metadata = parseJsonObject(row.metadata);
  const metadataSummary = summarizeConversationMetadata(metadata);
  const createdAt = safeText(row.created_at, "");
  const latestMessageAt = optionalText(row.latestMessageAt);
  const latestAttachmentAt = optionalText(row.latestAttachmentAt);
  const updatedAt = latestMessageAt ?? latestAttachmentAt ?? createdAt;
  const title = optionalText(row.title);
  return {
    id: Number(row.id ?? 0),
    label: `Conversation ${Number(row.id ?? 0)}`,
    title,
    summary: metadataSummary.summary ?? title ?? `Conversation ${Number(row.id ?? 0)}`,
    createdAt,
    updatedAt,
    messageCount: Number(row.messageCount ?? 0),
    attachmentCount: Number(row.attachmentCount ?? 0),
    relatedCheckpointId: metadataSummary.relatedCheckpointId,
    relatedArtifactId: metadataSummary.relatedArtifactId,
  };
}

function listConversationAttachments(db: MemoryDB, conversationId: number): WorkbenchConversationAttachment[] {
  const rows = db.db
    .prepare(
      `
      SELECT
        a.id,
        a.filename,
        a.path,
        a.content_type,
        a.size,
        a.created_at
      FROM attachments a
      WHERE a.conversation_id = ?
      ORDER BY a.created_at ASC, a.id ASC
      `
    )
    .all(conversationId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: Number(row.id ?? 0),
    filename: safeText(row.filename, "attachment"),
    path: safeText(row.path, ""),
    contentType: optionalText(row.content_type),
    size: optionalNumber(row.size),
    tags: listAttachmentTags(db, Number(row.id ?? 0)),
    createdAt: safeText(row.created_at, ""),
  }));
}

function listAttachmentTags(db: MemoryDB, attachmentId: number): string[] {
  const rows = db.db
    .prepare("SELECT tag FROM attachment_tags WHERE attachment_id = ? ORDER BY created_at ASC, id ASC")
    .all(attachmentId) as Record<string, unknown>[];
  return rows.map((row) => safeText(row.tag, "")).filter((tag) => tag.length > 0);
}

function listConversationMessages(db: MemoryDB, conversationId: number): WorkbenchConversationMessage[] {
  const rows = db.db
    .prepare(
      `
      SELECT
        id,
        conversation_id,
        role,
        provider,
        model,
        prompt,
        response,
        response_sha,
        attachments,
        created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY id ASC
      `
    )
    .all(conversationId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: Number(row.id ?? 0),
    conversationId: Number(row.conversation_id ?? conversationId),
    role: safeText(row.role, "user"),
    provider: optionalText(row.provider),
    model: optionalText(row.model),
    prompt: optionalText(row.prompt),
    response: optionalText(row.response),
    responseSha: optionalText(row.response_sha),
    attachments: parseAttachmentRefs(row.attachments),
    createdAt: safeText(row.created_at, ""),
  }));
}

function summarizeConversationCountRows(db: MemoryDB): number {
  const row = db.db.prepare("SELECT COUNT(*) AS count FROM conversations").get() as Record<string, unknown> | undefined;
  return Number(row?.count ?? 0);
}

function summarizeConversationRowWithCounts(db: MemoryDB, row: Record<string, unknown>): WorkbenchConversationSummary {
  const summary = summarizeConversationRow(row);
  return {
    ...summary,
    attachmentCount: Number(row.attachmentCount ?? summary.attachmentCount),
    messageCount: Number(row.messageCount ?? summary.messageCount),
  };
}

export function listWorkbenchConversations(db: MemoryDB, limit = 25): WorkbenchConversationCollection {
  const rows = db.db
    .prepare(
      `
      SELECT
        c.id,
        c.title,
        c.metadata,
        c.created_at,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount,
        (SELECT COUNT(*) FROM attachments a WHERE a.conversation_id = c.id) AS attachmentCount,
        (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id) AS latestMessageAt,
        (SELECT MAX(created_at) FROM attachments a WHERE a.conversation_id = c.id) AS latestAttachmentAt
      FROM conversations c
      ORDER BY COALESCE((SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id), (SELECT MAX(created_at) FROM attachments a WHERE a.conversation_id = c.id), c.created_at) DESC, c.id DESC
      LIMIT ?
      `
    )
    .all(limit) as Record<string, unknown>[];

  const totalCount = summarizeConversationCountRows(db);
  const items = rows.map((row) => summarizeConversationRowWithCounts(db, row));
  return {
    count: items.length,
    totalCount,
    items,
    emptyStateMessage: "No conversations are available yet. This is an intentional read-only empty state.",
  };
}

export function getWorkbenchConversation(db: MemoryDB, conversationId: number): WorkbenchConversationDetail | null {
  const row = db.db
    .prepare(
      `
      SELECT
        c.id,
        c.title,
        c.metadata,
        c.created_at,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount,
        (SELECT COUNT(*) FROM attachments a WHERE a.conversation_id = c.id) AS attachmentCount,
        (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id) AS latestMessageAt,
        (SELECT MAX(created_at) FROM attachments a WHERE a.conversation_id = c.id) AS latestAttachmentAt
      FROM conversations c
      WHERE c.id = ?
      LIMIT 1
      `
    )
    .get(conversationId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const metadata = parseJsonObject(row.metadata);
  const summary = summarizeConversationRow(row);

  return {
    ...summary,
    metadata,
    messages: listConversationMessages(db, conversationId),
    attachments: listConversationAttachments(db, conversationId),
  };
}
