import type { CapabilityApprovalClass, CapabilityCheckpointPolicy } from "../capabilities/manifest.js";
import type { PrismEventLedger } from "../events/ledger.js";

export const approvalStatuses = ["pending", "approved", "rejected", "cancelled", "expired"] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export const approvalDecisionStatuses = ["approved", "rejected", "cancelled"] as const;
export type ApprovalDecisionStatus = (typeof approvalDecisionStatuses)[number];

export const approvalLocalRemoteBoundaries = ["local-only", "remote-optional", "remote-required"] as const;
export type ApprovalLocalRemoteBoundary = (typeof approvalLocalRemoteBoundaries)[number];

export interface ApprovalDecision {
  status: ApprovalDecisionStatus;
  decidedAt: string;
  decidedBy: string;
  reason?: string;
}

export interface ApprovalRequest {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ApprovalStatus;
  title: string;
  summary: string;
  approvalClass: CapabilityApprovalClass;
  checkpointPolicy: CapabilityCheckpointPolicy;
  relatedCapabilityId?: string;
  relatedArtifactIds: string[];
  relatedFilePaths: string[];
  previewAvailable: boolean;
  previewSummary?: string;
  cliEquivalent?: string;
  riskNotes: string[];
  localRemoteBoundary: ApprovalLocalRemoteBoundary;
  requestedBy: string;
  decision: ApprovalDecision | null;
}

export interface ApprovalRequestInput {
  id?: string;
  title: string;
  summary: string;
  approvalClass: CapabilityApprovalClass;
  checkpointPolicy: CapabilityCheckpointPolicy;
  relatedCapabilityId?: string;
  relatedArtifactIds: string[];
  relatedFilePaths: string[];
  previewAvailable: boolean;
  previewSummary?: string;
  cliEquivalent?: string;
  riskNotes: string[];
  localRemoteBoundary: ApprovalLocalRemoteBoundary;
  requestedBy: string;
}

export interface ApprovalListOptions {
  limit?: number;
  status?: ApprovalStatus | ApprovalStatus[];
  approvalClass?: CapabilityApprovalClass | CapabilityApprovalClass[];
  relatedCapabilityId?: string;
  relatedArtifactId?: string;
  requestedBy?: string;
}

export interface ApprovalQueue {
  requestApproval(input: ApprovalRequestInput): ApprovalRequest;
  listApprovals(options?: ApprovalListOptions): ApprovalRequest[];
  getApproval(id: string): ApprovalRequest | undefined;
  resolveApproval(id: string, decision: ApprovalDecision): ApprovalRequest;
  clear(): void;
}

interface StoredApprovalRequest {
  seq: number;
  approval: ApprovalRequest;
}

function cloneApproval(approval: ApprovalRequest): ApprovalRequest {
  return structuredClone(approval);
}

function normalizeFilter<T extends string>(value: T | T[] | undefined): T[] | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value : [value];
}

function matchesFilter<T extends string>(value: T, filter: T[] | undefined): boolean {
  if (!filter) return true;
  return filter.includes(value);
}

function eventSeverityForDecision(status: ApprovalDecisionStatus): "info" | "low" | "medium" | "high" {
  if (status === "approved") return "info";
  if (status === "cancelled") return "low";
  return "medium";
}

export class InMemoryApprovalQueue implements ApprovalQueue {
  private seq = 0;
  private readonly approvals: StoredApprovalRequest[] = [];

  constructor(private readonly ledger?: PrismEventLedger) {}

  requestApproval(input: ApprovalRequestInput): ApprovalRequest {
    const now = new Date().toISOString();
    const approval: ApprovalRequest = {
      id: input.id?.trim() || `apr_${Date.now().toString(36)}_${(this.seq + 1).toString(36)}`,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      title: input.title.trim(),
      summary: input.summary.trim(),
      approvalClass: input.approvalClass,
      checkpointPolicy: input.checkpointPolicy,
      relatedCapabilityId: input.relatedCapabilityId?.trim() || undefined,
      relatedArtifactIds: [...input.relatedArtifactIds],
      relatedFilePaths: [...input.relatedFilePaths],
      previewAvailable: input.previewAvailable,
      previewSummary: input.previewSummary?.trim() || undefined,
      cliEquivalent: input.cliEquivalent?.trim() || undefined,
      riskNotes: [...input.riskNotes],
      localRemoteBoundary: input.localRemoteBoundary,
      requestedBy: input.requestedBy.trim(),
      decision: null,
    };

    this.seq += 1;
    this.approvals.push({ seq: this.seq, approval: cloneApproval(approval) });

    this.ledger?.append({
      type: "approval.requested",
      summary: `Approval requested: ${approval.title}`,
      severity: "info",
      source: "approval",
      relatedCapabilityId: approval.relatedCapabilityId,
      relatedArtifactId: approval.relatedArtifactIds[0],
      metadata: {
        approvalId: approval.id,
        approvalClass: approval.approvalClass,
        checkpointPolicy: approval.checkpointPolicy,
        localRemoteBoundary: approval.localRemoteBoundary,
      },
    });

    return cloneApproval(approval);
  }

  listApprovals(options: ApprovalListOptions = {}): ApprovalRequest[] {
    const statusFilter = normalizeFilter(options.status);
    const approvalClassFilter = normalizeFilter(options.approvalClass);
    const limit = options.limit ?? Number.POSITIVE_INFINITY;

    return this.approvals
      .filter(({ approval }) => {
        if (!matchesFilter(approval.status, statusFilter)) return false;
        if (!matchesFilter(approval.approvalClass, approvalClassFilter)) return false;
        if (options.relatedCapabilityId != null && approval.relatedCapabilityId !== options.relatedCapabilityId) return false;
        if (options.relatedArtifactId != null && !approval.relatedArtifactIds.includes(options.relatedArtifactId)) return false;
        if (options.requestedBy != null && approval.requestedBy !== options.requestedBy) return false;
        return true;
      })
      .sort((left, right) => {
        if (left.approval.updatedAt === right.approval.updatedAt) {
          return right.seq - left.seq;
        }
        return right.approval.updatedAt.localeCompare(left.approval.updatedAt);
      })
      .slice(0, limit)
      .map(({ approval }) => cloneApproval(approval));
  }

  getApproval(id: string): ApprovalRequest | undefined {
    const row = this.approvals.find((entry) => entry.approval.id === id);
    return row ? cloneApproval(row.approval) : undefined;
  }

  resolveApproval(id: string, decision: ApprovalDecision): ApprovalRequest {
    const row = this.approvals.find((entry) => entry.approval.id === id);
    if (!row) {
      throw new Error(`approval not found: ${id}`);
    }
    if (row.approval.status !== "pending") {
      throw new Error(`approval is not pending: ${id}`);
    }

    const updated: ApprovalRequest = {
      ...row.approval,
      status: decision.status,
      updatedAt: decision.decidedAt,
      decision: structuredClone(decision),
    };
    row.approval = cloneApproval(updated);

    this.ledger?.append({
      type: "approval.resolved",
      summary: `Approval ${decision.status}: ${updated.title}`,
      severity: eventSeverityForDecision(decision.status),
      source: "approval",
      relatedApprovalId: updated.id,
      relatedCapabilityId: updated.relatedCapabilityId,
      relatedArtifactId: updated.relatedArtifactIds[0],
      metadata: {
        approvalId: updated.id,
        decision: structuredClone(decision),
      },
    });

    return cloneApproval(updated);
  }

  clear(): void {
    this.approvals.length = 0;
    this.seq = 0;
  }
}

