import type { ApprovalQueue, ApprovalRequest, ApprovalStatus } from "../approvals/index.js";
import { listWorkbenchAttachments, type WorkbenchAttachmentSummary as WorkbenchProjectAttachmentSummary } from "./attachments.js";
import { listWorkbenchConversations, type WorkbenchConversationSummary as WorkbenchProjectConversationSummary } from "./conversations.js";
import type { MemoryDB } from "../memory/db.js";
import type { PrismEvent, PrismEventLedger } from "../events/index.js";

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

export interface WorkbenchResumeConversationSummary {
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
  sourceKind: "ledger" | "derived";
  sourceLabel: string;
  relatedArtifactId: string | null;
  relatedCapabilityId: string | null;
  relatedConversationId: string | null;
  relatedCheckpointId: number | null;
  relatedApprovalId: string | null;
  severity: "info" | "low" | "medium" | "high";
}

export interface WorkbenchApprovalItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ApprovalStatus;
  title: string;
  summary: string;
  actionSummary: string;
  approvalClass: string;
  checkpointPolicy: string;
  relatedCapabilityId: string | null;
  relatedArtifactIds: string[];
  relatedFilePaths: string[];
  previewAvailable: boolean;
  previewSummary: string | null;
  cliEquivalent: string | null;
  requestedBy: string;
  localBoundary: string;
  riskNotes: string[];
  decision: ApprovalRequest["decision"];
  example: boolean;
}

export interface WorkbenchChangeItem {
  id: string;
  time: string;
  type: string;
  summary: string;
  sourceKind: "ledger" | "derived";
  sourceLabel: string;
  relatedArtifactId: string | null;
  relatedCapabilityId: string | null;
  relatedConversationId: string | null;
  relatedCheckpointId: number | null;
  relatedApprovalId: string | null;
  severity: "info" | "low" | "medium" | "high";
}

export interface WorkbenchResumeData {
  daemonStatus: WorkbenchDaemonStatus;
  mode: WorkbenchMode;
  projectLabel: string;
  workDirLabel: string;
  lastActivity: WorkbenchLastActivity | null;
  lastActivitySummary: string;
  lastEventSummary: string;
  recentEventCount: number;
  pendingApprovalsCount: number;
  recentConversationCount: number;
  recentAttachmentCount: number;
  changedItemsCount: number;
  recentCheckpoints: WorkbenchCheckpointSummary[];
  recentConversations: WorkbenchProjectConversationSummary[];
  recentAttachments: WorkbenchProjectAttachmentSummary[];
  latestConversationSummary: string;
  latestAttachmentSummary: string;
  nextSafeAction: string;
  emptyStateMessage: string;
}

export interface WorkbenchApprovalsData {
  count: number;
  pendingCount: number;
  totalCount: number;
  items: WorkbenchApprovalItem[];
  emptyStateMessage: string;
}

export interface WorkbenchChangesData {
  count: number;
  ledgerCount: number;
  derivedCount: number;
  items: WorkbenchChangeItem[];
  emptyStateMessage: string;
}

export interface WorkbenchDataSpine {
  resume: WorkbenchResumeData;
  approvals: WorkbenchApprovalsData;
  changes: WorkbenchChangesData;
}

export interface BuildWorkbenchDataSpineOptions {
  projectLabel?: string;
  workDirLabel?: string;
  daemonStatus?: WorkbenchDaemonStatus;
  mode?: WorkbenchMode;
  eventLedger?: PrismEventLedger;
  approvalQueue?: ApprovalQueue;
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

function summarizeConversation(row: Record<string, unknown>): WorkbenchResumeConversationSummary {
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

function listRecentConversations(db: MemoryDB, limit: number): WorkbenchResumeConversationSummary[] {
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

function pickRelatedCapabilityId(event: PrismEvent | undefined): string | null {
  return event?.relatedCapabilityId ?? null;
}

function ledgerEventToChange(event: PrismEvent): WorkbenchChangeItem {
  return {
    id: `ledger:${event.id}`,
    time: event.time,
    type: event.type,
    summary: event.summary,
    sourceKind: "ledger",
    sourceLabel: "Event ledger",
    relatedArtifactId: event.relatedArtifactId ?? null,
    relatedCapabilityId: pickRelatedCapabilityId(event),
    relatedConversationId: event.relatedConversationId ?? null,
    relatedCheckpointId: event.relatedCheckpointId ?? null,
    relatedApprovalId: event.relatedApprovalId ?? null,
    severity: event.severity,
  };
}

function checkpointToChange(row: Record<string, unknown>): WorkbenchChangeItem {
  const hadChanges = Number(row.had_changes ?? 0) === 1;
  const rolledBack = Number(row.rolled_back ?? 0) === 1;
  const checkpointId = Number(row.id ?? 0);
  return {
    id: `checkpoint:${checkpointId}`,
    time: safeText(row.created_at, ""),
    type: "checkpoint.created",
    summary: `Checkpoint recorded for node ${safeText(row.node_id, "unknown node")} (${hadChanges ? "changes" : "no changes"})${rolledBack ? " and rolled back" : ""}.`,
    sourceKind: "derived",
    sourceLabel: "Checkpoint summary",
    relatedArtifactId: safeText(row.sha, "") || null,
    relatedCapabilityId: null,
    relatedConversationId: null,
    relatedCheckpointId: checkpointId || null,
    relatedApprovalId: null,
    severity: rolledBack ? "low" : hadChanges ? "medium" : "info",
  };
}

function conversationToChange(row: Record<string, unknown>): WorkbenchChangeItem {
  const conversationId = Number(row.id ?? 0);
  return {
    id: `conversation:${conversationId}`,
    time: safeText(row.created_at, ""),
    type: "conversation.created",
    summary: `Conversation ${safeText(row.title, "") || "untitled"} opened.`,
    sourceKind: "derived",
    sourceLabel: "Conversation summary",
    relatedArtifactId: `conversation:${conversationId}`,
    relatedCapabilityId: null,
    relatedConversationId: String(conversationId),
    relatedCheckpointId: null,
    relatedApprovalId: null,
    severity: "info",
  };
}

function previewText(value: unknown, fallback: string): string {
  const text = safeText(value, "");
  if (!text) return fallback;
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function messageToChange(row: Record<string, unknown>): WorkbenchChangeItem {
  const messageId = Number(row.id ?? 0);
  const conversationId = Number(row.conversation_id ?? 0);
  const messagePreview = previewText(row.response ?? row.prompt, "Message recorded.");
  return {
    id: `message:${messageId}`,
    time: safeText(row.created_at, ""),
    type: "message.summary",
    summary: `Message ${messageId} in conversation ${conversationId || "unknown"}: ${messagePreview}`,
    sourceKind: "derived",
    sourceLabel: "Message summary",
    relatedArtifactId: `message:${messageId}`,
    relatedCapabilityId: null,
    relatedConversationId: conversationId ? String(conversationId) : null,
    relatedCheckpointId: null,
    relatedApprovalId: null,
    severity: "info",
  };
}

function attachmentToChange(row: Record<string, unknown>): WorkbenchChangeItem {
  const attachmentId = Number(row.id ?? 0);
  const conversationId = row.conversation_id == null ? null : Number(row.conversation_id);
  const filename = safeText(row.filename, `attachment-${attachmentId}`);
  const size = Number(row.size ?? 0);
  return {
    id: `attachment:${attachmentId}`,
    time: safeText(row.created_at, ""),
    type: "attachment.summary",
    summary: `Attachment ${filename}${size > 0 ? ` (${size} bytes)` : ""} recorded.`,
    sourceKind: "derived",
    sourceLabel: "Attachment summary",
    relatedArtifactId: `attachment:${attachmentId}`,
    relatedCapabilityId: null,
    relatedConversationId: conversationId ? String(conversationId) : null,
    relatedCheckpointId: null,
    relatedApprovalId: null,
    severity: "info",
  };
}

function approvalToItem(approval: ApprovalRequest): WorkbenchApprovalItem {
  return {
    id: approval.id,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
    status: approval.status,
    title: approval.title,
    summary: approval.summary,
    actionSummary: approval.title,
    approvalClass: approval.approvalClass,
    checkpointPolicy: approval.checkpointPolicy,
    relatedCapabilityId: optionalText(approval.relatedCapabilityId),
    relatedArtifactIds: [...approval.relatedArtifactIds],
    relatedFilePaths: [...approval.relatedFilePaths],
    previewAvailable: approval.previewAvailable,
    previewSummary: optionalText(approval.previewSummary),
    cliEquivalent: optionalText(approval.cliEquivalent),
    requestedBy: approval.requestedBy,
    localBoundary: approval.localRemoteBoundary,
    riskNotes: [...approval.riskNotes],
    decision: approval.decision ? structuredClone(approval.decision) : null,
    example: false,
  };
}

function chooseNextSafeAction(
  pendingApprovalsCount: number,
  recentConversationCount: number,
  recentAttachmentCount: number,
  recentEventCount: number,
): string {
  if (pendingApprovalsCount > 0) {
    return "Review pending approvals";
  }
  if (recentConversationCount > 0 || recentAttachmentCount > 0) {
    return "Review recent project memory";
  }
  if (recentEventCount > 0) {
    return "Review recent changes";
  }
  return "No urgent action";
}

function collectDerivedChangeItems(db: MemoryDB, limit: number): WorkbenchChangeItem[] {
  const checkpoints = db.db
    .prepare("SELECT id, node_id, sha, had_changes, rolled_back, created_at FROM checkpoints ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  const conversations = db.db
    .prepare("SELECT id, title, created_at FROM conversations ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  const messages = db.db
    .prepare("SELECT id, conversation_id, prompt, response, created_at FROM messages ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  const attachments = db.db
    .prepare("SELECT id, conversation_id, filename, size, created_at FROM attachments ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];

  const items = [
    ...checkpoints.map(checkpointToChange),
    ...conversations.map(conversationToChange),
    ...messages.map(messageToChange),
    ...attachments.map(attachmentToChange),
  ];

  items.sort((left, right) => right.time.localeCompare(left.time) || left.id.localeCompare(right.id));
  return items.slice(0, limit);
}

export function buildWorkbenchChanges(db: MemoryDB, options: BuildWorkbenchDataSpineOptions, limit = 12): WorkbenchChangesData {
  const ledgerEvents = options.eventLedger?.list({ limit }) ?? [];
  const ledgerItems = ledgerEvents.map(ledgerEventToChange);
  const derivedItems = collectDerivedChangeItems(db, limit);
  const items = [...ledgerItems, ...derivedItems].sort((left, right) => {
    if (left.time === right.time) {
      if (left.sourceKind === right.sourceKind) {
        return left.id.localeCompare(right.id);
      }
      return left.sourceKind === "ledger" ? -1 : 1;
    }
    return right.time.localeCompare(left.time);
  }).slice(0, limit);

  return {
    count: items.length,
    ledgerCount: ledgerItems.length,
    derivedCount: derivedItems.length,
    items,
    emptyStateMessage: "No changes are available yet. This is an intentional read-only empty state.",
  };
}

export function buildWorkbenchApprovals(options: BuildWorkbenchDataSpineOptions, limit = 25): WorkbenchApprovalsData {
  const pending = options.approvalQueue?.listApprovals({ status: "pending", limit }) ?? [];
  const all = options.approvalQueue?.listApprovals({ limit }) ?? [];

  return {
    count: pending.length,
    pendingCount: pending.length,
    totalCount: all.length,
    items: pending.map(approvalToItem),
    emptyStateMessage: "No pending approvals are queued yet. Approval execution remains gated elsewhere.",
  };
}

export function buildWorkbenchResume(db: MemoryDB, options: BuildWorkbenchDataSpineOptions): WorkbenchResumeData {
  const recentCheckpoints = listRecentCheckpoints(db, 5);
  const recentConversationCollection = listWorkbenchConversations(db, 5);
  const recentAttachmentCollection = listWorkbenchAttachments(db, 5, options.eventLedger);
  const approvals = buildWorkbenchApprovals(options);
  const changes = buildWorkbenchChanges(db, options, 12);
  const allLedgerEvents = options.eventLedger?.list() ?? [];
  const lastLedgerEvent = allLedgerEvents[0] ?? null;
  const lastActivity = lastLedgerEvent ? ledgerEventToChange(lastLedgerEvent) : null;
  const recentEventCount = allLedgerEvents.length;
  const lastEventSummary = lastLedgerEvent?.summary ?? "No events recorded yet.";
  const latestConversationSummary = recentConversationCollection.items[0]?.summary ?? "No conversations recorded yet.";
  const latestAttachmentSummary = recentAttachmentCollection.items[0]?.displayName ?? recentAttachmentCollection.items[0]?.filename ?? "No attachments recorded yet.";

  const resume: WorkbenchResumeData = {
    daemonStatus: options.daemonStatus ?? "healthy",
    mode: options.mode ?? "read-only",
    projectLabel: options.projectLabel ?? "workspace",
    workDirLabel: options.workDirLabel ?? ".demo/work",
    lastActivity,
    lastActivitySummary: lastEventSummary,
    lastEventSummary,
    recentEventCount,
    pendingApprovalsCount: approvals.pendingCount,
    recentConversationCount: recentConversationCollection.totalCount,
    recentAttachmentCount: recentAttachmentCollection.totalCount,
    changedItemsCount: changes.count,
    recentCheckpoints,
    recentConversations: recentConversationCollection.items,
    recentAttachments: recentAttachmentCollection.items,
    latestConversationSummary,
    latestAttachmentSummary,
    nextSafeAction: chooseNextSafeAction(
      approvals.pendingCount,
      recentConversationCollection.totalCount,
      recentAttachmentCollection.totalCount,
      recentEventCount,
    ),
    emptyStateMessage: "No daemon history has been recorded yet. Empty states here are intentional.",
  };

  return resume;
}

export function buildWorkbenchDataSpine(db: MemoryDB, options: BuildWorkbenchDataSpineOptions): WorkbenchDataSpine {
  return {
    resume: buildWorkbenchResume(db, options),
    approvals: buildWorkbenchApprovals(options),
    changes: buildWorkbenchChanges(db, options),
  };
}
