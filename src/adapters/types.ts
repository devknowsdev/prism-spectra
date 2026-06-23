export type AdapterId = string;

export const ADAPTER_KINDS = [
  "local_model",
  "remote_model",
  "filesystem",
  "database",
  "git",
  "email",
  "calendar",
  "social_publishing",
  "media_tool",
  "search",
  "unknown",
] as const;

export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export const ADAPTER_MODES = ["mock", "real", "dry_run", "preview"] as const;
export type AdapterMode = (typeof ADAPTER_MODES)[number];

export const ADAPTER_RISK_LEVELS = [
  "read_only",
  "local_write",
  "external_draft",
  "external_write",
  "destructive",
] as const;

export type AdapterRiskLevel = (typeof ADAPTER_RISK_LEVELS)[number];

export const APPROVAL_REQUIREMENTS = ["none", "recommended", "required"] as const;
export type ApprovalRequirement = (typeof APPROVAL_REQUIREMENTS)[number];

export interface ApprovalContext {
  granted: boolean;
  approver?: string;
  reason?: string;
  approvedAt?: string;
}

export interface AdapterContext {
  requestId?: string;
  sessionId?: string;
  actor?: string;
  origin?: string;
  mode?: AdapterMode;
  dryRun?: boolean;
  approval?: ApprovalContext;
  metadata?: Record<string, unknown>;
}

export interface AdapterCapability {
  id: string;
  label: string;
  kind: AdapterKind;
  description?: string;
  riskLevel: AdapterRiskLevel;
  approvalRequired: ApprovalRequirement;
}

export interface AdapterAction {
  id: string;
  capabilityId: string;
  kind: AdapterKind;
  operation: string;
  input?: Record<string, unknown>;
  riskLevel: AdapterRiskLevel;
  approvalRequired?: ApprovalRequirement;
}

export interface AdapterError {
  code: string;
  message: string;
  adapterId: AdapterId;
  actionId: string;
  details?: Record<string, unknown>;
}

export interface AdapterHealth {
  status: "healthy" | "degraded" | "unhealthy";
  checkedAt: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface AdapterDescriptor {
  id: AdapterId;
  kind: AdapterKind;
  mode: AdapterMode;
  approvalRequired: ApprovalRequirement;
}

export interface AdapterResult<T = unknown> {
  adapterId: AdapterId;
  adapterKind: AdapterKind;
  adapterMode: AdapterMode;
  actionId: string;
  capabilityId: string;
  operation: string;
  riskLevel: AdapterRiskLevel;
  approvalRequired: ApprovalRequirement;
  success: boolean;
  blocked: boolean;
  output: T | null;
  error?: AdapterError;
  metadata?: Record<string, unknown>;
  checkedAt: string;
}

export interface AdapterContract<T = unknown> extends AdapterDescriptor {
  name: string;
  capabilities: AdapterCapability[];
  health?: () => Promise<AdapterHealth> | AdapterHealth;
  execute: (action: AdapterAction, context: AdapterContext) => Promise<AdapterResult<T>> | AdapterResult<T>;
}

export function approvalRequirementForRisk(riskLevel: AdapterRiskLevel): ApprovalRequirement {
  switch (riskLevel) {
    case "read_only":
      return "none";
    case "local_write":
    case "external_draft":
      return "recommended";
    case "external_write":
    case "destructive":
      return "required";
  }
}

export function isHighRiskRiskLevel(riskLevel: AdapterRiskLevel): boolean {
  return riskLevel === "external_write" || riskLevel === "destructive";
}

export function isExternalRiskLevel(riskLevel: AdapterRiskLevel): boolean {
  return riskLevel === "external_draft" || isHighRiskRiskLevel(riskLevel);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createAdapterError(
  adapterId: AdapterId,
  actionId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): AdapterError {
  return { adapterId, actionId, code, message, details };
}

export function createAdapterResult<T>(
  adapter: AdapterDescriptor,
  action: AdapterAction,
  opts: {
    success: boolean;
    blocked: boolean;
    output: T | null;
    error?: AdapterError;
    metadata?: Record<string, unknown>;
  },
): AdapterResult<T> {
  return {
    adapterId: adapter.id,
    adapterKind: adapter.kind,
    adapterMode: adapter.mode,
    actionId: action.id,
    capabilityId: action.capabilityId,
    operation: action.operation,
    riskLevel: action.riskLevel,
    approvalRequired: action.approvalRequired ?? approvalRequirementForRisk(action.riskLevel),
    success: opts.success,
    blocked: opts.blocked,
    output: opts.output,
    error: opts.error,
    metadata: opts.metadata,
    checkedAt: nowIso(),
  };
}

