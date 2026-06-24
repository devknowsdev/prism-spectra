import type { MemoryDB } from "../memory/db.js";

export interface WorkbenchAttachmentMessage {
  id: number;
  conversationId: number;
  role: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
  prompt: string | null;
  response: string | null;
  attachments: string[];
}

export interface WorkbenchAttachmentAuditEntry {
  id: number;
  action: string;
  details: string | null;
  actor: string | null;
  createdAt: string;
}

export interface WorkbenchAttachmentSummary {
  id: number;
  label: string;
  filename: string;
  path: string;
  contentType: string | null;
  size: number | null;
  sha256: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  conversationId: number | null;
  conversationTitle: string | null;
  metadataStatus: string;
  relatedCheckpointId: number | null;
  relatedArtifactId: string | null;
}

export interface WorkbenchAttachmentDetail extends WorkbenchAttachmentSummary {
  relatedConversations: { id: number; title: string | null }[];
  relatedMessages: WorkbenchAttachmentMessage[];
  auditTrail: WorkbenchAttachmentAuditEntry[];
  repairAvailable: boolean;
  compareAvailable: boolean;
}

export interface WorkbenchAttachmentCollection {
  count: number;
  totalCount: number;
  items: WorkbenchAttachmentSummary[];
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

function listAttachmentTags(db: MemoryDB, attachmentId: number): string[] {
  const rows = db.db
    .prepare("SELECT tag FROM attachment_tags WHERE attachment_id = ? ORDER BY created_at ASC, id ASC")
    .all(attachmentId) as Record<string, unknown>[];
  return rows.map((row) => safeText(row.tag, "")).filter((tag) => tag.length > 0);
}

function listAttachmentAuditTrail(db: MemoryDB, attachmentId: number): WorkbenchAttachmentAuditEntry[] {
  const rows = db.db
    .prepare(
      "SELECT id, action, details, actor, created_at FROM attachment_audit WHERE attachment_id = ? ORDER BY created_at DESC, id DESC"
    )
    .all(attachmentId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id ?? 0),
    action: safeText(row.action, "unknown"),
    details: optionalText(row.details),
    actor: optionalText(row.actor),
    createdAt: safeText(row.created_at, ""),
  }));
}

function isRepairable(contentType: string | null, filename: string): boolean {
  if (!filename) return false;
  const lowerFilename = filename.toLowerCase();
  const lowerType = (contentType || "").toLowerCase();
  return (
    lowerType.startsWith("text/") ||
    lowerType.includes("json") ||
    lowerType.includes("xml") ||
    /\.(txt|md|json|json5|js|ts|jsx|tsx|css|html|yaml|yml|csv|log)$/i.test(lowerFilename)
  );
}

function metadataStatusForAttachment(row: Record<string, unknown>, tags: string[]): string {
  const parts: string[] = [];
  if (safeText(row.content_type, "").length > 0) parts.push("typed");
  if (typeof row.size === "number" || Number(row.size ?? 0) > 0) parts.push("sized");
  if (safeText(row.sha256, "").length > 0) parts.push("fingerprinted");
  if (tags.length > 0) parts.push("tagged");
  return parts.length > 0 ? parts.join(" · ") : "basic";
}

function summarizeAttachmentRow(db: MemoryDB, row: Record<string, unknown>): WorkbenchAttachmentSummary {
  const tags = listAttachmentTags(db, Number(row.id ?? 0));
  const conversationId = row.conversation_id == null ? null : Number(row.conversation_id);
  const conversationTitleRow = conversationId == null
    ? undefined
    : (db.db.prepare("SELECT title FROM conversations WHERE id = ? LIMIT 1").get(conversationId) as Record<string, unknown> | undefined);
  const latestAuditRow = db.db.prepare("SELECT MAX(created_at) AS updatedAt FROM attachment_audit WHERE attachment_id = ?").get(Number(row.id ?? 0)) as Record<string, unknown> | undefined;
  const createdAt = safeText(row.created_at, "");
  const updatedAt = optionalText(latestAuditRow?.updatedAt) ?? createdAt;

  return {
    id: Number(row.id ?? 0),
    label: safeText(row.filename, `Attachment ${Number(row.id ?? 0)}`),
    filename: safeText(row.filename, "attachment"),
    path: safeText(row.path, ""),
    contentType: optionalText(row.content_type),
    size: optionalNumber(row.size),
    sha256: optionalText(row.sha256),
    tags,
    createdAt,
    updatedAt,
    conversationId,
    conversationTitle: optionalText(conversationTitleRow?.title),
    metadataStatus: metadataStatusForAttachment(row, tags),
    relatedCheckpointId: null,
    relatedArtifactId: `attachment:${Number(row.id ?? 0)}`,
  };
}

function countAttachments(db: MemoryDB): number {
  const row = db.db.prepare("SELECT COUNT(*) AS count FROM attachments").get() as Record<string, unknown> | undefined;
  return Number(row?.count ?? 0);
}

function parseRelatedMessages(db: MemoryDB, row: Record<string, unknown>): WorkbenchAttachmentMessage[] {
  const attachmentId = Number(row.id ?? 0);
  const filename = safeText(row.filename, "");
  const conversationId = row.conversation_id == null ? null : Number(row.conversation_id);
  const exactMatches: Record<string, unknown>[] = [];

  if (conversationId != null) {
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
          attachments,
          created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY id ASC
        `
      )
      .all(conversationId) as Record<string, unknown>[];
    exactMatches.push(...rows);
  } else if (filename.length > 0) {
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
          attachments,
          created_at
        FROM messages
        WHERE attachments LIKE ? OR attachments LIKE ?
        ORDER BY id ASC
        `
      )
      .all(`%${attachmentId}%`, `%${filename}%`) as Record<string, unknown>[];
    exactMatches.push(...rows);
  }

  return exactMatches.map((message) => ({
    id: Number(message.id ?? 0),
    conversationId: Number(message.conversation_id ?? 0),
    role: safeText(message.role, "user"),
    provider: optionalText(message.provider),
    model: optionalText(message.model),
    createdAt: safeText(message.created_at, ""),
    prompt: optionalText(message.prompt),
    response: optionalText(message.response),
    attachments: parseAttachmentRefs(message.attachments),
  }));
}

export function listWorkbenchAttachments(db: MemoryDB, limit = 25): WorkbenchAttachmentCollection {
  const rows = db.db
    .prepare(
      `
      SELECT
        id,
        conversation_id,
        filename,
        path,
        content_type,
        size,
        sha256,
        created_at
      FROM attachments
      ORDER BY created_at DESC, id DESC
      LIMIT ?
      `
    )
    .all(limit) as Record<string, unknown>[];

  const items = rows.map((row) => summarizeAttachmentRow(db, row));
  return {
    count: items.length,
    totalCount: countAttachments(db),
    items,
    emptyStateMessage: "No attachments are available yet. This is an intentional read-only empty state.",
  };
}

export function getWorkbenchAttachment(db: MemoryDB, attachmentId: number): WorkbenchAttachmentDetail | null {
  const row = db.db
    .prepare(
      `
      SELECT
        id,
        conversation_id,
        filename,
        path,
        content_type,
        size,
        sha256,
        created_at
      FROM attachments
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(attachmentId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const summary = summarizeAttachmentRow(db, row);
  const relatedMessages = parseRelatedMessages(db, row);
  const conversationTitle = summary.conversationTitle;
  const relatedConversations = summary.conversationId == null
    ? []
    : [{ id: summary.conversationId, title: conversationTitle }];
  const auditTrail = listAttachmentAuditTrail(db, attachmentId);
  const totalRow = db.db.prepare("SELECT COUNT(*) AS count FROM attachments").get() as Record<string, unknown> | undefined;
  const compareAvailable = Number(totalRow?.count ?? 0) > 1;

  return {
    ...summary,
    relatedConversations,
    relatedMessages,
    auditTrail,
    repairAvailable: isRepairable(summary.contentType, summary.filename),
    compareAvailable,
  };
}
