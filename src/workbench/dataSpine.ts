import type { MemoryDB } from "../memory/db.js";

export type WorkbenchDaemonStatus = "starting" | "healthy" | "degraded";
export type WorkbenchMode = "read-only";

export interface WorkbenchCheckpointSummary {
  id: number;
  nodeId: string | null;
  graphId: string | null;
  sha: string;
  hadChanges: boolean;
  createdAt: string;
  rolledBack: boolean;
  rolledBackAt: string | null;
}

export interface WorkbenchConversationSummary {
  id: number;
  title: string | null;
  messageCount: number;
  createdAt: string;
  latestMessageAt: string | null;
}

export interface WorkbenchLastActivity {
  id: string;
  time: string;
  type: string;
  summary: string;
  relatedArtifactId: string | null;
  relatedCapabilityId: string | null;
  relatedCheckpointId: number | null;
  severity: "info" | "low" | "medium" | "high";
}

export interface WorkbenchApprovalItem {
  id: string;
  actionSummary: string;
  affectedItems: string[];
  approvalClass: string;
  checkpointPolicy: string;
  previewAvailable: boolean;
  localBoundary: string;
  cliEquivalent: string;
  riskNotes: string[];
  example: boolean;
}

export interface WorkbenchChangeItem {
  id: string;
  time: string;
  type: string;
  summary: string;
  relatedArtifactId: string | null;
  relatedCapabilityId: string | null;
  relatedCheckpointId: number | null;
  severity: "info" | "low" | "medium" | "high";
}

export interface WorkbenchResumeData {
  daemonStatus: WorkbenchDaemonStatus;
  mode: WorkbenchMode;
  projectLabel: string;
  workDirLabel: string;
  lastActivity: WorkbenchLastActivity | null;
  lastActivitySummary: string;
  pendingApprovalsCount: number;
  changedItemsCount: number;
  recentCheckpoints: WorkbenchCheckpointSummary[];
  recentConversations: WorkbenchConversationSummary[];
  nextSafeAction: string;
  emptyStateMessage: string;
}

export interface WorkbenchApprovalsData {
  count: number;
  items: WorkbenchApprovalItem[];
  emptyStateMessage: string;
}

export interface WorkbenchChangesData {
  count: number;
  items: WorkbenchChangeItem[];
  emptyStateMessage: string;
}

export interface WorkbenchDataSpine {
  resume: WorkbenchResumeData;
  approvals: WorkbenchApprovalsData;
  changes: WorkbenchChangesData;
}

export interface BuildWorkbenchDataSpineOptions {
  projectLabel: string;
  workDirLabel: string;
  daemonStatus?: WorkbenchDaemonStatus;
  mode?: WorkbenchMode;
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

function parseDetailsForCapabilityId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const candidate = (parsed as Record<string, unknown>).capabilityId ?? (parsed as Record<string, unknown>).manifestId ?? (parsed as Record<string, unknown>).capability;
    return safeText(candidate, "") || null;
  } catch {
    return null;
  }
}

function summarizeCheckpoint(row: Record<string, unknown>): WorkbenchCheckpointSummary {
  return {
    id: Number(row.id ?? 0),
    nodeId: optionalText(row.node_id),
    graphId: optionalText(row.graph_id),
    sha: safeText(row.sha, ""),
    hadChanges: Number(row.had_changes ?? 0) === 1,
    createdAt: safeText(row.created_at, ""),
    rolledBack: Number(row.rolled_back ?? 0) === 1,
    rolledBackAt: optionalText(row.rolled_back_at),
  };
}

function summarizeConversation(row: Record<string, unknown>): WorkbenchConversationSummary {
  return {
    id: Number(row.id ?? 0),
    title: optionalText(row.title),
    messageCount: Number(row.messageCount ?? 0),
    createdAt: safeText(row.created_at, ""),
    latestMessageAt: optionalText(row.latestMessageAt),
  };
}

function listRecentCheckpoints(db: MemoryDB, limit: number): WorkbenchCheckpointSummary[] {
  const rows = db.db
    .prepare(
      "SELECT id, project_id, graph_id, node_id, sha, had_changes, rolled_back, created_at, rolled_back_at FROM checkpoints ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map(summarizeCheckpoint);
}

function listRecentConversations(db: MemoryDB, limit: number): WorkbenchConversationSummary[] {
  const rows = db.db
    .prepare(
      `
      SELECT
        c.id,
        c.title,
        c.created_at,
        COUNT(m.id) AS messageCount,
        MAX(m.created_at) AS latestMessageAt
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id
      ORDER BY COALESCE(MAX(m.created_at), c.created_at) DESC, c.id DESC
      LIMIT ?
      `
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map(summarizeConversation);
}

function listRecentChanges(db: MemoryDB, limit: number): WorkbenchChangeItem[] {
  const checkpoints = db.db
    .prepare(
      "SELECT id, graph_id, node_id, sha, had_changes, rolled_back, created_at, rolled_back_at FROM checkpoints ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as Record<string, unknown>[];
  const auditRows = db.db
    .prepare(
      "SELECT id, scope, object_id, action, details, actor, created_at FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as Record<string, unknown>[];
  const attachmentRows = db.db
    .prepare(
      "SELECT id, attachment_id, action, details, actor, created_at FROM attachment_audit ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as Record<string, unknown>[];
  const conversationRows = db.db
    .prepare(
      "SELECT id, title, created_at FROM conversations ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as Record<string, unknown>[];
  const messageRows = db.db
    .prepare(
      "SELECT m.id, m.conversation_id, m.role, m.created_at, c.title AS conversation_title FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id ORDER BY m.created_at DESC, m.id DESC LIMIT ?"
    )
    .all(limit) as Record<string, unknown>[];
  const attachmentRowsLatest = db.db
    .prepare(
      "SELECT id, conversation_id, filename, content_type, size, created_at FROM attachments ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as Record<string, unknown>[];

  const items: WorkbenchChangeItem[] = [];

  for (const row of checkpoints) {
    const hadChanges = Number(row.had_changes ?? 0) === 1;
    const rolledBack = Number(row.rolled_back ?? 0) === 1;
    items.push({
      id: `checkpoint:${row.id}`,
      time: safeText(row.created_at, ""),
      type: "checkpoint.created",
      summary: `Checkpoint recorded for node ${safeText(row.node_id, "unknown node")} (${hadChanges ? "changes" : "no changes"})${rolledBack ? " and rolled back" : ""}.`,
      relatedArtifactId: safeText(row.sha, "") || null,
      relatedCapabilityId: null,
      relatedCheckpointId: Number(row.id ?? 0),
      severity: rolledBack ? "low" : hadChanges ? "medium" : "info",
    });
  }

  for (const row of auditRows) {
    const capabilityId = parseDetailsForCapabilityId(row.details);
    items.push({
      id: `audit:${row.id}`,
      time: safeText(row.created_at, ""),
      type: `${safeText(row.scope, "audit")}.${safeText(row.action, "event")}`,
      summary: `Audit event ${safeText(row.action, "event")} for ${safeText(row.object_id, "unknown object")}.`,
      relatedArtifactId: safeText(row.object_id, "") || null,
      relatedCapabilityId: capabilityId,
      relatedCheckpointId: null,
      severity: "info",
    });
  }

  for (const row of attachmentRows) {
    const capabilityId = parseDetailsForCapabilityId(row.details);
    items.push({
      id: `attachment-audit:${row.id}`,
      time: safeText(row.created_at, ""),
      type: `attachment.${safeText(row.action, "event")}`,
      summary: `Attachment audit: ${safeText(row.action, "event")} for attachment ${safeText(row.attachment_id, "unknown")}.`,
      relatedArtifactId: safeText(row.attachment_id, "") || null,
      relatedCapabilityId: capabilityId,
      relatedCheckpointId: null,
      severity: "info",
    });
  }

  for (const row of conversationRows) {
    items.push({
      id: `conversation:${row.id}`,
      time: safeText(row.created_at, ""),
      type: "conversation.created",
      summary: `Conversation ${safeText(row.title, "") || "untitled"} opened.`,
      relatedArtifactId: `conversation:${safeText(row.id, "")}`,
      relatedCapabilityId: null,
      relatedCheckpointId: null,
      severity: "info",
    });
  }

  for (const row of messageRows) {
    items.push({
      id: `message:${row.id}`,
      time: safeText(row.created_at, ""),
      type: "message.created",
      summary: `Message ${safeText(row.role, "message")} recorded${safeText(row.conversation_title, "") ? ` in ${safeText(row.conversation_title, "")}` : ""}.`,
      relatedArtifactId: `conversation:${safeText(row.conversation_id, "")}`,
      relatedCapabilityId: null,
      relatedCheckpointId: null,
      severity: "info",
    });
  }

  for (const row of attachmentRowsLatest) {
    items.push({
      id: `attachment:${row.id}`,
      time: safeText(row.created_at, ""),
      type: "attachment.created",
      summary: `Attachment ${safeText(row.filename, "untitled file")} stored${safeText(row.conversation_id, "") ? ` for conversation ${safeText(row.conversation_id, "")}` : ""}.`,
      relatedArtifactId: safeText(row.filename, "") || `attachment:${safeText(row.id, "")}`,
      relatedCapabilityId: null,
      relatedCheckpointId: null,
      severity: "info",
    });
  }

  items.sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
  return items.slice(0, limit);
}

function chooseNextSafeAction(resume: Pick<WorkbenchResumeData, "pendingApprovalsCount" | "changedItemsCount" | "recentConversations">): string {
  if (resume.pendingApprovalsCount > 0) {
    return "Review pending approvals before taking any write or remote action.";
  }
  if (resume.changedItemsCount > 0) {
    return "Open Changes to inspect the latest read-only provenance trail.";
  }
  if (resume.recentConversations.length > 0) {
    return "Open the newest conversation and keep the shell in read-only mode.";
  }
  return "Stay in Resume and wait for daemon data or manifest-driven next steps.";
}

export function buildWorkbenchChanges(db: MemoryDB, limit = 12): WorkbenchChangesData {
  const items = listRecentChanges(db, limit);
  return {
    count: items.length,
    items,
    emptyStateMessage: "No changes are available yet. This is an intentional read-only empty state.",
  };
}

export function buildWorkbenchApprovals(_db: MemoryDB): WorkbenchApprovalsData {
  return {
    count: 0,
    items: [],
    emptyStateMessage: "No pending approvals are queued yet. Approval execution remains gated elsewhere.",
  };
}

export function buildWorkbenchResume(db: MemoryDB, options: BuildWorkbenchDataSpineOptions): WorkbenchResumeData {
  const recentCheckpoints = listRecentCheckpoints(db, 5);
  const recentConversations = listRecentConversations(db, 5);
  const approvals = buildWorkbenchApprovals(db);
  const changes = buildWorkbenchChanges(db, 12);
  const lastActivity = changes.items[0] ?? null;
  const resume: WorkbenchResumeData = {
    daemonStatus: options.daemonStatus ?? "healthy",
    mode: options.mode ?? "read-only",
    projectLabel: options.projectLabel,
    workDirLabel: options.workDirLabel,
    lastActivity,
    lastActivitySummary: lastActivity?.summary ?? "No daemon activity has been recorded yet.",
    pendingApprovalsCount: approvals.count,
    changedItemsCount: changes.count,
    recentCheckpoints,
    recentConversations,
    nextSafeAction: "Stay in Resume and wait for daemon data or manifest-driven next steps.",
    emptyStateMessage: "No daemon history has been recorded yet. Empty states here are intentional.",
  };

  resume.nextSafeAction = chooseNextSafeAction(resume);
  return resume;
}

export function buildWorkbenchDataSpine(db: MemoryDB, options: BuildWorkbenchDataSpineOptions): WorkbenchDataSpine {
  return {
    resume: buildWorkbenchResume(db, options),
    approvals: buildWorkbenchApprovals(db),
    changes: buildWorkbenchChanges(db),
  };
}
