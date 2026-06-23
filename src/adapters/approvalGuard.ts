import {
  type AdapterAction,
  type AdapterContext,
  type AdapterContract,
  type AdapterDescriptor,
  type AdapterError,
  type AdapterResult,
  approvalRequirementForRisk,
  createAdapterError,
  createAdapterResult,
  isHighRiskRiskLevel,
} from "./types.js";

export class AdapterGuardError extends Error {
  readonly adapterError: AdapterError;

  constructor(adapterError: AdapterError) {
    super(adapterError.message);
    this.name = "AdapterGuardError";
    this.adapterError = adapterError;
  }
}

function hasExplicitApproval(context: AdapterContext): boolean {
  return context.approval?.granted === true;
}

function isPublishingLikeOperation(operation: string): boolean {
  return /publish|send|post|delete/i.test(operation);
}

function isAllowedWithoutApproval(action: AdapterAction): boolean {
  return action.riskLevel === "read_only" || action.riskLevel === "local_write" || action.riskLevel === "external_draft";
}

export function validateAdapterContract(contract: AdapterContract): void {
  if (!contract.id.trim()) {
    throw new Error("Adapter contract id is required.");
  }
  if (!contract.name.trim()) {
    throw new Error(`Adapter ${contract.id} must have a name.`);
  }
  if (!contract.capabilities.length) {
    throw new Error(`Adapter ${contract.id} must declare at least one capability.`);
  }

  const highRiskCapabilities = contract.capabilities.filter((capability) => isHighRiskRiskLevel(capability.riskLevel));
  for (const capability of highRiskCapabilities) {
    if (capability.approvalRequired !== "required") {
      throw new Error(
        `Adapter ${contract.id} capability ${capability.id} must declare approvalRequired: required for ${capability.riskLevel}.`,
      );
    }
  }

  if (highRiskCapabilities.length > 0 && contract.approvalRequired !== "required") {
    throw new Error(`Adapter ${contract.id} must declare approvalRequired: required because it supports external_write or destructive actions.`);
  }
}

export function ensureApprovalAllowed(adapter: AdapterDescriptor, context: AdapterContext, action: AdapterAction): void {
  if (adapter.kind === "unknown" && !isAllowedWithoutApproval(action)) {
    throw new AdapterGuardError(
      createAdapterError(
        adapter.id,
        action.id,
        "unknown_adapter_risk",
        `Adapter ${adapter.id} is unknown and cannot execute ${action.operation} at risk level ${action.riskLevel}.`,
        { kind: adapter.kind, riskLevel: action.riskLevel },
      ),
    );
  }

  if (isAllowedWithoutApproval(action)) {
    return;
  }

  const approvalRequired = action.approvalRequired ?? approvalRequirementForRisk(action.riskLevel);
  const approved = hasExplicitApproval(context);
  const publishingLike = isPublishingLikeOperation(action.operation);

  if (isHighRiskRiskLevel(action.riskLevel) || publishingLike || approvalRequired === "required") {
    if (!approved) {
      throw new AdapterGuardError(
        createAdapterError(
          adapter.id,
          action.id,
          "approval_required",
          `Adapter ${adapter.id} requires explicit approval for ${action.operation} (${action.riskLevel}).`,
          { operation: action.operation, riskLevel: action.riskLevel, approvalRequired },
        ),
      );
    }
  }
}

export function blockedAdapterResult<T>(
  adapter: AdapterDescriptor,
  action: AdapterAction,
  error: AdapterError,
  metadata?: Record<string, unknown>,
): AdapterResult<T> {
  return createAdapterResult<T>(adapter, action, {
    success: false,
    blocked: true,
    output: null,
    error,
    metadata,
  });
}

export function approvalContextLabel(context: AdapterContext): string {
  if (!context.approval?.granted) return "unapproved";
  return context.approval.approver ? `approved by ${context.approval.approver}` : "approved";
}

