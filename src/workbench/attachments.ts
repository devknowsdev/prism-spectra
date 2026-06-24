import type { MemoryDB } from "../memory/db.js";
import type { PrismEventLedger } from "../events/ledger.js";

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

export const attachmentPreviewKinds = ["none", "image", "text", "audio", "video", "pdf", "binary", "unknown"] as const;
export type AttachmentPreviewKind = (typeof attachmentPreviewKinds)[number];

export const attachmentPreviewStatuses = ["available", "unavailable", "blocked", "unsupported", "pending", "failed"] as const;
export type AttachmentPreviewStatus = (typeof attachmentPreviewStatuses)[number];

export type AttachmentPreviewSource = "mime" | "extension" | "unknown";

export interface AttachmentPreviewSummary {
  kind: AttachmentPreviewKind;
  status: AttachmentPreviewStatus;
  label: string;
  reason?: string;
  safeToRenderInline: boolean;
  requiresExternalTool: boolean;
  requiresUserAction: boolean;
  capabilityId?: string;
  riskNotes: string[];
  source: AttachmentPreviewSource;
}

export interface AttachmentPreviewPolicy {
  inlineKinds: readonly AttachmentPreviewKind[];
  largeAttachmentWarningBytes: number;
}

export const attachmentPreviewPolicy: AttachmentPreviewPolicy = {
  inlineKinds: ["image", "audio", "video", "pdf"],
  largeAttachmentWarningBytes: 5 * 1024 * 1024,
};

export interface WorkbenchAttachmentSummary {
  id: number;
  label: string;
  displayName: string;
  originalName: string;
  filename: string;
  path: string;
  sourcePath: string;
  contentType: string | null;
  mimeType: string | null;
  size: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  tags: string[];
  sourceKind: "local";
  createdAt: string;
  importedAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  conversationId: number | null;
  conversationTitle: string | null;
  metadataStatus: string;
  relatedConversationIds: number[];
  relatedCheckpointIds: number[];
  relatedEventIds: string[];
  relatedCheckpointId: number | null;
  relatedArtifactId: string | null;
  preview: AttachmentPreviewSummary;
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

function attachmentExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

function previewCapabilityId(kind: AttachmentPreviewKind): string | undefined {
  switch (kind) {
    case "image":
      return "sharp.image.thumbnail";
    case "audio":
      return "wavesurfer.audio.preview";
    case "video":
      return "ffmpeg.video.clip";
    default:
      return undefined;
  }
}

function previewKindFromMimeOrExtension(mimeType: string | null, filename: string): { kind: AttachmentPreviewKind; source: AttachmentPreviewSource } {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return { kind: "image", source: "mime" };
  if (mime.startsWith("text/")) return { kind: "text", source: "mime" };
  if (mime.startsWith("audio/")) return { kind: "audio", source: "mime" };
  if (mime.startsWith("video/")) return { kind: "video", source: "mime" };
  if (mime === "application/pdf") return { kind: "pdf", source: "mime" };
  if (mime === "application/octet-stream") return { kind: "binary", source: "mime" };

  const ext = attachmentExtension(filename);
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(ext)) return { kind: "image", source: "extension" };
  if (["txt", "md", "markdown", "json", "json5", "yaml", "yml", "csv", "log", "xml", "html", "htm", "css", "js", "ts", "jsx", "tsx"].includes(ext)) {
    return { kind: "text", source: "extension" };
  }
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"].includes(ext)) return { kind: "audio", source: "extension" };
  if (["mp4", "m4v", "mov", "webm", "mkv"].includes(ext)) return { kind: "video", source: "extension" };
  if (ext === "pdf") return { kind: "pdf", source: "extension" };
  if (["bin", "dat", "exe", "zip", "tar", "gz", "7z"].includes(ext)) return { kind: "binary", source: "extension" };

  if (mime.length > 0) return { kind: "unknown", source: "unknown" };
  return { kind: "none", source: "unknown" };
}

export function deriveAttachmentPreviewSummary(input: {
  displayName?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sourcePath?: string | null;
}): AttachmentPreviewSummary {
  const fallbackName = safeText(input.originalName, safeText(input.displayName, "attachment"));
  const { kind, source } = previewKindFromMimeOrExtension(optionalText(input.mimeType), fallbackName);
  const sizeBytes = typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes) ? input.sizeBytes : null;
  const largeAttachment = sizeBytes != null && sizeBytes >= attachmentPreviewPolicy.largeAttachmentWarningBytes;
  const riskNotes: string[] = [];
  if (largeAttachment) {
    riskNotes.push("Large attachments may take longer to preview in the browser.");
  }

  const hasSourcePath = safeText(input.sourcePath, "").length > 0;

  if (!hasSourcePath) {
    return {
      kind: kind === "none" ? "unknown" : kind,
      status: "blocked",
      label: "Preview blocked",
      reason: "Attachment does not have a safe local source path.",
      safeToRenderInline: false,
      requiresExternalTool: false,
      requiresUserAction: false,
      capabilityId: previewCapabilityId(kind),
      riskNotes: [...riskNotes, "Preview route needs a safe local file reference."],
      source,
    };
  }

  if (kind === "image" || kind === "audio" || kind === "video" || kind === "pdf") {
    return {
      kind,
      status: "available",
      label:
        kind === "image"
          ? "Browser-native image preview"
          : kind === "audio"
            ? "Browser audio preview"
            : kind === "video"
              ? "Browser video preview"
              : "Browser PDF preview",
      safeToRenderInline: true,
      requiresExternalTool: false,
      requiresUserAction: false,
      capabilityId: previewCapabilityId(kind),
      riskNotes,
      source,
    };
  }

  if (kind === "text") {
    return {
      kind,
      status: "unavailable",
      label: "Text preview pending",
      reason: "Text preview will be enabled when a safe text preview route exists.",
      safeToRenderInline: false,
      requiresExternalTool: false,
      requiresUserAction: false,
      capabilityId: undefined,
      riskNotes: [...riskNotes, "Do not read attachment contents during metadata projection."],
      source,
    };
  }

  if (kind === "binary") {
    return {
      kind,
      status: "unsupported",
      label: "Binary preview unavailable",
      reason: "Binary attachments do not have a safe browser-native preview yet.",
      safeToRenderInline: false,
      requiresExternalTool: false,
      requiresUserAction: false,
      capabilityId: undefined,
      riskNotes: [...riskNotes, "Future preview capability will need an explicit approval gate."],
      source,
    };
  }

  return {
    kind: kind === "none" ? "unknown" : kind,
    status: "unsupported",
    label: "Preview unavailable",
    reason: "Attachment type could not be determined from stored metadata.",
    safeToRenderInline: false,
    requiresExternalTool: false,
    requiresUserAction: false,
    capabilityId: undefined,
    riskNotes: [...riskNotes, "Preview classification stayed conservative because metadata was incomplete."],
    source,
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
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
  } catch (error) {
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

function latestAttachmentUpload(db: MemoryDB, attachmentId: number): { originalName: string | null; importedAt: string | null } {
  const row = db.db
    .prepare(
      `
      SELECT details, created_at
      FROM attachment_audit
      WHERE attachment_id = ? AND action = 'upload'
      ORDER BY created_at ASC, id ASC
      LIMIT 1
      `
    )
    .get(attachmentId) as Record<string, unknown> | undefined;

  const details = parseJsonObject(row?.details);
  const originalName = optionalText(details?.filename ?? details?.originalName ?? details?.displayName);
  const importedAt = optionalText(row?.created_at);
  return { originalName, importedAt };
}

function conversationRelatedCheckpointIds(db: MemoryDB, conversationId: number | null): number[] {
  if (conversationId == null) return [];
  const row = db.db.prepare("SELECT metadata FROM conversations WHERE id = ? LIMIT 1").get(conversationId) as Record<string, unknown> | undefined;
  const metadata = parseJsonObject(row?.metadata);
  const related = metadata?.relatedCheckpointId ?? metadata?.checkpointId;
  if (typeof related === "number" && Number.isFinite(related)) {
    return [related];
  }
  return [];
}

function listRelatedAttachmentEventIds(ledger: PrismEventLedger | undefined, attachmentId: number): string[] {
  if (!ledger) return [];
  return ledger.list({ relatedArtifactId: `attachment:${attachmentId}` }).map((event) => event.id);
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

function metadataStatusForAttachment(row: Record<string, unknown>, tags: string[], originalName: string | null): string {
  const parts: string[] = ["local"];
  if (safeText(row.content_type, "").length > 0) parts.push("typed");
  if (typeof row.size === "number" || Number(row.size ?? 0) > 0) parts.push("sized");
  if (safeText(row.sha256, "").length > 0) parts.push("fingerprinted");
  if (tags.length > 0) parts.push("tagged");
  if (originalName && safeText(row.filename, "") !== originalName) parts.push("edited");
  return parts.join(" · ");
}

function summarizeAttachmentRow(db: MemoryDB, row: Record<string, unknown>, eventLedger?: PrismEventLedger): WorkbenchAttachmentSummary {
  const attachmentId = Number(row.id ?? 0);
  const tags = listAttachmentTags(db, attachmentId);
  const conversationId = row.conversation_id == null ? null : Number(row.conversation_id);
  const upload = latestAttachmentUpload(db, attachmentId);
  const conversationTitleRow = conversationId == null
    ? undefined
    : (db.db.prepare("SELECT title FROM conversations WHERE id = ? LIMIT 1").get(conversationId) as Record<string, unknown> | undefined);
  const latestAuditRow = db.db.prepare("SELECT MAX(created_at) AS updatedAt FROM attachment_audit WHERE attachment_id = ?").get(attachmentId) as Record<string, unknown> | undefined;
  const createdAt = safeText(row.created_at, "");
  const updatedAt = optionalText(latestAuditRow?.updatedAt) ?? createdAt;
  const displayName = safeText(row.filename, `Attachment ${attachmentId}`);
  const originalName = upload.originalName ?? displayName;
  const sourcePath = safeText(row.path, "");
  const mimeType = optionalText(row.content_type);
  const sizeBytes = optionalNumber(row.size);
  const preview = deriveAttachmentPreviewSummary({
    displayName,
    originalName,
    mimeType,
    sizeBytes,
    sourcePath,
  });
  const relatedConversationIds = conversationId == null ? [] : [conversationId];
  const relatedCheckpointIds = conversationRelatedCheckpointIds(db, conversationId);
  const relatedEventIds = listRelatedAttachmentEventIds(eventLedger, attachmentId);

  return {
    id: attachmentId,
    label: displayName,
    displayName,
    originalName,
    filename: displayName,
    path: sourcePath,
    sourcePath,
    contentType: mimeType,
    mimeType,
    size: sizeBytes,
    sizeBytes,
    sha256: optionalText(row.sha256),
    tags,
    sourceKind: "local",
    createdAt,
    importedAt: upload.importedAt ?? createdAt,
    updatedAt,
    metadata: {
      sourceKind: "local",
      originalName,
      displayName,
      mimeType,
      sizeBytes,
      sourcePath,
      importedAt: upload.importedAt ?? createdAt,
      updatedAt,
      tags: [...tags],
    },
    conversationId,
    conversationTitle: optionalText(conversationTitleRow?.title),
    metadataStatus: metadataStatusForAttachment(row, tags, originalName),
    relatedConversationIds,
    relatedCheckpointIds,
    relatedEventIds,
    relatedCheckpointId: relatedCheckpointIds[0] ?? null,
    relatedArtifactId: `attachment:${attachmentId}`,
    preview,
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

export function listWorkbenchAttachments(db: MemoryDB, limit = 25, eventLedger?: PrismEventLedger): WorkbenchAttachmentCollection {
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

  const items = rows.map((row) => summarizeAttachmentRow(db, row, eventLedger));
  return {
    count: items.length,
    totalCount: countAttachments(db),
    items,
    emptyStateMessage: "No attachments are available yet. This is an intentional read-only empty state.",
  };
}

export function getWorkbenchAttachment(db: MemoryDB, attachmentId: number, eventLedger?: PrismEventLedger): WorkbenchAttachmentDetail | null {
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

  const summary = summarizeAttachmentRow(db, row, eventLedger);
  const relatedMessages = parseRelatedMessages(db, row);
  const relatedConversations = summary.conversationId == null
    ? []
    : [{ id: summary.conversationId, title: summary.conversationTitle }];
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
