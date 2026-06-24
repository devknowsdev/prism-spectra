import type { ApprovalQueue, ApprovalRequest, ApprovalStatus } from "../approvals/index.js";
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
  changedItemsCount: number;
  recentCheckpoints: WorkbenchCheckpointSummary[];
  recentConversations: WorkbenchConversationSummary[];
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

function chooseNextSafeAction(pendingApprovalsCount: number, recentEventCount: number): string {
  if (pendingApprovalsCount > 0) {
    return "Review pending approvals";
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

  const items = [
    ...checkpoints.map(checkpointToChange),
    ...conversations.map(conversationToChange),
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
  const recentConversations = listRecentConversations(db, 5);
  const approvals = buildWorkbenchApprovals(options);
  const changes = buildWorkbenchChanges(db, options, 12);
  const allLedgerEvents = options.eventLedger?.list() ?? [];
  const lastLedgerEvent = allLedgerEvents[0] ?? null;
  const lastActivity = lastLedgerEvent ? ledgerEventToChange(lastLedgerEvent) : null;
  const recentEventCount = allLedgerEvents.length;
  const lastEventSummary = lastLedgerEvent?.summary ?? "No events recorded yet.";

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
    changedItemsCount: changes.count,
    recentCheckpoints,
    recentConversations,
    nextSafeAction: chooseNextSafeAction(approvals.pendingCount, recentEventCount),
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
