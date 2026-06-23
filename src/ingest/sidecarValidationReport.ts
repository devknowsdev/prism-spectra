import { PRISM_SIDECAR_SCHEMA_VERSION } from "./sidecarTypes.js";
import {
  planLocalFileRoundTrip,
  type LocalFileRoundTripPlan,
  type LocalFileRoundTripPlanInput,
  type LocalFileRoundTripSidecarStatus,
  type LocalFileRoundTripSourceStatus,
} from "./localFileRoundTripPlanner.js";
import type { PrismSidecar } from "./sidecarTypes.js";

export type SidecarValidationStatus = "valid" | "review_needed" | "missing" | "blocked";
export type SidecarValidationSchemaVersionStatus = "current" | "legacy_missing" | "unsupported" | "not_applicable";
export type SidecarValidationRecommendedAction = "none" | "create_sidecar" | "update_sidecar_hash" | "review_sidecar" | "blocked";
export type SidecarValidationIssueSeverity = "info" | "warning" | "error";

export interface SidecarValidationIssue {
  code: string;
  severity: SidecarValidationIssueSeverity;
  message: string;
}

export interface SidecarValidationReport {
  status: SidecarValidationStatus;
  sourcePath: string;
  sidecarPath: string;
  sourceStatus: LocalFileRoundTripSourceStatus;
  sidecarStatus: LocalFileRoundTripSidecarStatus;
  schemaVersionStatus: SidecarValidationSchemaVersionStatus;
  issues: SidecarValidationIssue[];
  recommendedAction: SidecarValidationRecommendedAction;
  canAutoPlan: boolean;
  canExecuteWithApproval: boolean;
}

function issue(code: string, severity: SidecarValidationIssueSeverity, message: string): SidecarValidationIssue {
  return { code, severity, message };
}

function schemaVersionStatusForPlan(plan: LocalFileRoundTripPlan): SidecarValidationSchemaVersionStatus {
  if (plan.reasons.includes("unsupported_schemaVersion")) {
    return "unsupported";
  }

  if (!plan.sidecar) {
    return "not_applicable";
  }

  if (!Object.prototype.hasOwnProperty.call(plan.sidecar, "schemaVersion") || plan.sidecar.schemaVersion === undefined) {
    return "legacy_missing";
  }

  return plan.sidecar.schemaVersion === PRISM_SIDECAR_SCHEMA_VERSION ? "current" : "unsupported";
}

function recommendedActionForReport(
  plan: LocalFileRoundTripPlan,
  schemaVersionStatus: SidecarValidationSchemaVersionStatus,
): SidecarValidationRecommendedAction {
  if (plan.sourceStatus === "blocked" || plan.sidecarStatus === "blocked") {
    return "blocked";
  }

  if (plan.sourceStatus === "missing") {
    return "blocked";
  }

  if (plan.sidecarStatus === "missing") {
    return "create_sidecar";
  }

  if (plan.sidecarStatus === "stale") {
    return schemaVersionStatus === "unsupported" ? "review_sidecar" : "update_sidecar_hash";
  }

  if (plan.sidecarStatus === "valid" && schemaVersionStatus === "current") {
    return "none";
  }

  if (plan.sidecarStatus === "valid" && schemaVersionStatus === "legacy_missing") {
    return "none";
  }

  if (plan.sidecarStatus === "malformed" || plan.sidecarStatus === "mismatched_source") {
    return "review_sidecar";
  }

  if (schemaVersionStatus === "unsupported") {
    return "review_sidecar";
  }

  return "blocked";
}

function reportStatusForPlan(
  plan: LocalFileRoundTripPlan,
  schemaVersionStatus: SidecarValidationSchemaVersionStatus,
): SidecarValidationStatus {
  if (plan.sourceStatus === "blocked" || plan.sourceStatus === "missing" || plan.sidecarStatus === "blocked") {
    return "blocked";
  }

  if (plan.sidecarStatus === "missing") {
    return "missing";
  }

  if (plan.sidecarStatus === "stale" || plan.sidecarStatus === "malformed" || plan.sidecarStatus === "mismatched_source" || schemaVersionStatus === "unsupported") {
    return "review_needed";
  }

  if (plan.sidecarStatus === "valid" && (schemaVersionStatus === "current" || schemaVersionStatus === "legacy_missing")) {
    return "valid";
  }

  return "blocked";
}

function canAutoPlanForReport(recommendedAction: SidecarValidationRecommendedAction): boolean {
  return recommendedAction === "create_sidecar" || recommendedAction === "update_sidecar_hash";
}

function canExecuteWithApprovalForReport(
  plan: LocalFileRoundTripPlan,
  recommendedAction: SidecarValidationRecommendedAction,
): boolean {
  if (plan.sourceStatus !== "present") {
    return false;
  }

  return recommendedAction === "create_sidecar" || recommendedAction === "update_sidecar_hash";
}

function issueForMissingSidecar(): SidecarValidationIssue {
  return issue("sidecar_missing", "warning", "Adjacent sidecar is missing; a caller may create one later.");
}

function issueForLegacyMissingSchemaVersion(): SidecarValidationIssue {
  return issue(
    "legacy_schemaVersion_missing",
    "warning",
    `Legacy sidecar omits schemaVersion; new sidecars emit schemaVersion ${PRISM_SIDECAR_SCHEMA_VERSION}.`,
  );
}

function issueForUnsupportedSchemaVersion(): SidecarValidationIssue {
  return issue("unsupported_schemaVersion", "error", "Sidecar schemaVersion is unsupported and requires review.");
}

function issuesFromReasons(reasons: string[], severity: SidecarValidationIssueSeverity): SidecarValidationIssue[] {
  return reasons.map((reason) => issue(reason, severity, `Sidecar validation reported ${reason}.`));
}

function buildIssues(plan: LocalFileRoundTripPlan, schemaVersionStatus: SidecarValidationSchemaVersionStatus): SidecarValidationIssue[] {
  if (plan.sourceStatus === "blocked") {
    return issuesFromReasons(plan.reasons.length > 0 ? plan.reasons : ["source_blocked"], "error");
  }

  if (plan.sourceStatus === "missing") {
    return issuesFromReasons(plan.reasons.length > 0 ? plan.reasons : ["source_missing"], "error");
  }

  if (plan.sidecarStatus === "blocked") {
    return issuesFromReasons(plan.reasons.length > 0 ? plan.reasons : ["sidecar_blocked"], "error");
  }

  if (plan.sidecarStatus === "missing") {
    return [issueForMissingSidecar()];
  }

  if (schemaVersionStatus === "unsupported") {
    return [issueForUnsupportedSchemaVersion()];
  }

  if (plan.sidecarStatus === "stale") {
    const issues = plan.reasons.map((reason) => issue(reason, "warning", `Sidecar validation reported ${reason}.`));
    if (schemaVersionStatus === "legacy_missing") {
      issues.push(issueForLegacyMissingSchemaVersion());
    }
    return issues;
  }

  if (plan.sidecarStatus === "malformed") {
    return issuesFromReasons(plan.reasons.length > 0 ? plan.reasons : ["sidecar_shape_invalid"], "error");
  }

  if (plan.sidecarStatus === "mismatched_source") {
    const issues = issuesFromReasons(plan.reasons.length > 0 ? plan.reasons : ["source_path_mismatch"], "error");
    if (schemaVersionStatus === "legacy_missing") {
      issues.push(issueForLegacyMissingSchemaVersion());
    }
    return issues;
  }

  if (plan.sidecarStatus === "valid" && schemaVersionStatus === "legacy_missing") {
    return [issueForLegacyMissingSchemaVersion()];
  }

  return [];
}

function buildSidecarValidationReport(plan: LocalFileRoundTripPlan): SidecarValidationReport {
  const schemaVersionStatus = schemaVersionStatusForPlan(plan);
  const recommendedAction = recommendedActionForReport(plan, schemaVersionStatus);
  const status = reportStatusForPlan(plan, schemaVersionStatus);
  const issues = buildIssues(plan, schemaVersionStatus);

  return {
    status,
    sourcePath: plan.sourcePath,
    sidecarPath: plan.sidecarPath,
    sourceStatus: plan.sourceStatus,
    sidecarStatus: plan.sidecarStatus,
    schemaVersionStatus,
    issues,
    recommendedAction,
    canAutoPlan: canAutoPlanForReport(recommendedAction),
    canExecuteWithApproval: canExecuteWithApprovalForReport(plan, recommendedAction),
  };
}

export async function validateLocalFileSidecar(input: LocalFileRoundTripPlanInput): Promise<SidecarValidationReport> {
  const plan = await planLocalFileRoundTrip(input);
  return buildSidecarValidationReport(plan);
}
