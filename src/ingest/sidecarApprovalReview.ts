import type { LocalFileRoundTripPlan } from "./localFileRoundTripPlanner.js";
import type { SidecarRecommendation } from "./sidecarRecommendation.js";
import type { SidecarValidationReport } from "./sidecarValidationReport.js";
import type { SidecarWritePlan } from "./sidecarWritePlan.js";

export type SidecarApprovalReviewStatus = "approval_required" | "not_applicable" | "blocked";
export type SidecarApprovalReviewType = "local_write" | "none";
export type SidecarApprovalReviewOperation = "create_sidecar" | "update_sidecar" | "none";
export type SidecarApprovalReviewRiskLevel = "low" | "medium" | "blocked";

export interface SidecarApprovalReview {
  status: SidecarApprovalReviewStatus;
  approvalType: SidecarApprovalReviewType;
  sourcePath: string;
  sidecarPath: string;
  title: string;
  summary: string;
  proposedOperation: SidecarApprovalReviewOperation;
  riskLevel: SidecarApprovalReviewRiskLevel;
  userFacingChanges: string[];
  safetyChecks: string[];
  reasons: string[];
  warnings: string[];
  canApprove: boolean;
}

export interface SidecarApprovalReviewInput {
  planner?: LocalFileRoundTripPlan;
  recommendation?: SidecarRecommendation;
  writePlan?: SidecarWritePlan;
  validationReport?: SidecarValidationReport;
}

const CREATE_SIDECAR_USER_FACING_CHANGES = [
  "schemaVersion",
  "assetId",
  "sourcePath",
  "canonicalPath",
  "sha256",
  "sizeBytes",
  "createdAt",
  "updatedAt",
  "kind",
  "tags",
  "derivedFiles",
  "analysisStatus",
  "approvalState",
  "notes",
];

const UPDATE_SIDECAR_USER_FACING_CHANGES = ["sha256", "sizeBytes", "updatedAt"];

const CREATE_SIDECAR_SAFETY_CHECKS = [
  "source path must remain explicit",
  "sidecar path must stay adjacent to the source file",
  "existing sidecar must not be overwritten",
  "local_write approval is required before file changes",
];

const UPDATE_SIDECAR_SAFETY_CHECKS = [
  "source path must remain explicit",
  "sidecar path must stay adjacent to the source file",
  "current sidecar must still match the requested source file",
  "only sha256, sizeBytes, and updatedAt may change",
];

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function blockedReview(
  sourcePath: string,
  sidecarPath: string,
  title: string,
  summary: string,
  reasons: readonly string[],
  warnings: readonly string[],
): SidecarApprovalReview {
  return {
    status: "blocked",
    approvalType: "none",
    sourcePath,
    sidecarPath,
    title,
    summary,
    proposedOperation: "none",
    riskLevel: "blocked",
    userFacingChanges: [],
    safetyChecks: [],
    reasons: uniqueStrings(reasons),
    warnings: uniqueStrings(warnings),
    canApprove: false,
  };
}

function notApplicableReview(
  sourcePath: string,
  sidecarPath: string,
  title: string,
  summary: string,
  reasons: readonly string[],
  warnings: readonly string[],
): SidecarApprovalReview {
  return {
    status: "not_applicable",
    approvalType: "none",
    sourcePath,
    sidecarPath,
    title,
    summary,
    proposedOperation: "none",
    riskLevel: "low",
    userFacingChanges: [],
    safetyChecks: [],
    reasons: uniqueStrings(reasons),
    warnings: uniqueStrings(warnings),
    canApprove: false,
  };
}

function approvalRequiredReview(
  sourcePath: string,
  sidecarPath: string,
  operation: Exclude<SidecarApprovalReviewOperation, "none">,
  title: string,
  summary: string,
  reasons: readonly string[],
  warnings: readonly string[],
  userFacingChanges: readonly string[],
  safetyChecks: readonly string[],
): SidecarApprovalReview {
  return {
    status: "approval_required",
    approvalType: "local_write",
    sourcePath,
    sidecarPath,
    title,
    summary,
    proposedOperation: operation,
    riskLevel: operation === "update_sidecar" ? "medium" : "low",
    userFacingChanges: uniqueStrings(userFacingChanges),
    safetyChecks: uniqueStrings(safetyChecks),
    reasons: uniqueStrings(reasons),
    warnings: uniqueStrings(warnings),
    canApprove: true,
  };
}

function reportReasons(report: SidecarValidationReport): string[] {
  if (report.recommendedAction === "none") {
    return ["sidecar_ready"];
  }

  if (report.issues.length > 0) {
    return report.issues.map((issue) => issue.code);
  }

  return [report.recommendedAction];
}

function reportWarnings(report: SidecarValidationReport): string[] {
  return report.issues.map((issue) => issue.message);
}

function reviewFromWritePlan(writePlan: SidecarWritePlan): SidecarApprovalReview {
  switch (writePlan.status) {
    case "planned":
      switch (writePlan.operation) {
        case "create_sidecar":
          return approvalRequiredReview(
            writePlan.sourcePath,
            writePlan.sidecarPath,
            "create_sidecar",
            "Approve sidecar creation",
            `Create ${writePlan.sidecarPath} for ${writePlan.sourcePath}.`,
            writePlan.reasons,
            writePlan.warnings,
            CREATE_SIDECAR_USER_FACING_CHANGES,
            writePlan.safetyChecks.length > 0 ? writePlan.safetyChecks : CREATE_SIDECAR_SAFETY_CHECKS,
          );

        case "update_sidecar":
          return approvalRequiredReview(
            writePlan.sourcePath,
            writePlan.sidecarPath,
            "update_sidecar",
            "Approve sidecar refresh",
            `Refresh ${writePlan.sidecarPath} for ${writePlan.sourcePath} with current hash metadata.`,
            writePlan.reasons,
            writePlan.warnings,
            UPDATE_SIDECAR_USER_FACING_CHANGES,
            writePlan.safetyChecks.length > 0 ? writePlan.safetyChecks : UPDATE_SIDECAR_SAFETY_CHECKS,
          );

        default:
          return blockedReview(
            writePlan.sourcePath,
            writePlan.sidecarPath,
            "Sidecar review blocked",
            `The sidecar write plan for ${writePlan.sourcePath} is not a supported approval target.`,
            ["unsupported_write_plan_operation"],
            ["write plan operation must be create_sidecar or update_sidecar"],
          );
      }

    case "not_applicable":
      return notApplicableReview(
        writePlan.sourcePath,
        writePlan.sidecarPath,
        "No sidecar approval needed",
        `No sidecar write is required for ${writePlan.sourcePath}.`,
        writePlan.reasons,
        writePlan.warnings,
      );

    case "blocked":
      return blockedReview(
        writePlan.sourcePath,
        writePlan.sidecarPath,
        "Sidecar review blocked",
        `Sidecar approval is blocked for ${writePlan.sourcePath}.`,
        writePlan.reasons,
        writePlan.warnings,
      );

    default:
      return blockedReview(
        writePlan.sourcePath,
        writePlan.sidecarPath,
        "Sidecar review blocked",
        `Sidecar approval could not interpret the write plan for ${writePlan.sourcePath}.`,
        ["unsupported_write_plan_state"],
        [`unsupported write plan status: ${(writePlan as { status?: string }).status ?? "unknown"}`],
      );
  }
}

function reviewFromValidationReport(report: SidecarValidationReport): SidecarApprovalReview {
  const reasons = reportReasons(report);
  const warnings = reportWarnings(report);

  switch (report.recommendedAction) {
    case "create_sidecar":
      return approvalRequiredReview(
        report.sourcePath,
        report.sidecarPath,
        "create_sidecar",
        "Approve sidecar creation",
        `Create ${report.sidecarPath} for ${report.sourcePath}.`,
        reasons,
        warnings,
        CREATE_SIDECAR_USER_FACING_CHANGES,
        CREATE_SIDECAR_SAFETY_CHECKS,
      );

    case "update_sidecar_hash":
      return approvalRequiredReview(
        report.sourcePath,
        report.sidecarPath,
        "update_sidecar",
        "Approve sidecar refresh",
        `Refresh ${report.sidecarPath} for ${report.sourcePath} with current hash metadata.`,
        reasons,
        warnings,
        UPDATE_SIDECAR_USER_FACING_CHANGES,
        UPDATE_SIDECAR_SAFETY_CHECKS,
      );

    case "none":
      return notApplicableReview(
        report.sourcePath,
        report.sidecarPath,
        "No sidecar approval needed",
        `No sidecar write is required for ${report.sourcePath}.`,
        reasons,
        warnings,
      );

    case "review_sidecar":
    case "blocked":
      return blockedReview(
        report.sourcePath,
        report.sidecarPath,
        "Sidecar review blocked",
        `Sidecar approval is blocked for ${report.sourcePath}.`,
        reasons,
        warnings,
      );

    default:
      return blockedReview(
        report.sourcePath,
        report.sidecarPath,
        "Sidecar review blocked",
        `Sidecar approval could not interpret the validation report for ${report.sourcePath}.`,
        reasons,
        warnings,
      );
  }
}

function reviewFromRecommendation(recommendation: SidecarRecommendation): SidecarApprovalReview {
  const warnings = recommendation.warnings;

  switch (recommendation.action) {
    case "create_sidecar":
      return approvalRequiredReview(
        recommendation.sourcePath,
        recommendation.sidecarPath,
        "create_sidecar",
        "Approve sidecar creation",
        `Create ${recommendation.sidecarPath} for ${recommendation.sourcePath}.`,
        [recommendation.reason],
        warnings,
        recommendation.draft ? Object.keys(recommendation.draft) : CREATE_SIDECAR_USER_FACING_CHANGES,
        CREATE_SIDECAR_SAFETY_CHECKS,
      );

    case "update_sidecar_hash":
      return approvalRequiredReview(
        recommendation.sourcePath,
        recommendation.sidecarPath,
        "update_sidecar",
        "Approve sidecar refresh",
        `Refresh ${recommendation.sidecarPath} for ${recommendation.sourcePath} with current hash metadata.`,
        [recommendation.reason],
        warnings,
        recommendation.patch ? Object.keys(recommendation.patch) : UPDATE_SIDECAR_USER_FACING_CHANGES,
        UPDATE_SIDECAR_SAFETY_CHECKS,
      );

    case "ready":
      return notApplicableReview(
        recommendation.sourcePath,
        recommendation.sidecarPath,
        "No sidecar approval needed",
        `No sidecar write is required for ${recommendation.sourcePath}.`,
        [recommendation.reason],
        warnings,
      );

    case "review_sidecar":
    case "blocked":
      return blockedReview(
        recommendation.sourcePath,
        recommendation.sidecarPath,
        "Sidecar review blocked",
        `Sidecar approval is blocked for ${recommendation.sourcePath}.`,
        [recommendation.reason],
        warnings,
      );

    default:
      return blockedReview(
        recommendation.sourcePath,
        recommendation.sidecarPath,
        "Sidecar review blocked",
        `Sidecar approval could not interpret the recommendation for ${recommendation.sourcePath}.`,
        [recommendation.reason],
        warnings,
      );
  }
}

function reviewFromPlanner(plan: LocalFileRoundTripPlan): SidecarApprovalReview {
  switch (plan.recommendedAction) {
    case "create_sidecar":
      return approvalRequiredReview(
        plan.sourcePath,
        plan.sidecarPath,
        "create_sidecar",
        "Approve sidecar creation",
        `Create ${plan.sidecarPath} for ${plan.sourcePath}.`,
        plan.reasons.length > 0 ? plan.reasons : ["sidecar_missing"],
        [],
        CREATE_SIDECAR_USER_FACING_CHANGES,
        CREATE_SIDECAR_SAFETY_CHECKS,
      );

    case "update_sidecar_hash":
      return approvalRequiredReview(
        plan.sourcePath,
        plan.sidecarPath,
        "update_sidecar",
        "Approve sidecar refresh",
        `Refresh ${plan.sidecarPath} for ${plan.sourcePath} with current hash metadata.`,
        plan.reasons.length > 0 ? plan.reasons : ["sidecar_stale"],
        [],
        UPDATE_SIDECAR_USER_FACING_CHANGES,
        UPDATE_SIDECAR_SAFETY_CHECKS,
      );

    case "ready":
      return notApplicableReview(
        plan.sourcePath,
        plan.sidecarPath,
        "No sidecar approval needed",
        `No sidecar write is required for ${plan.sourcePath}.`,
        plan.reasons.length > 0 ? plan.reasons : ["sidecar_ready"],
        [],
      );

    case "review_sidecar":
    case "blocked":
      return blockedReview(
        plan.sourcePath,
        plan.sidecarPath,
        "Sidecar review blocked",
        `Sidecar approval is blocked for ${plan.sourcePath}.`,
        plan.reasons,
        [],
      );

    default:
      return blockedReview(
        plan.sourcePath,
        plan.sidecarPath,
        "Sidecar review blocked",
        `Sidecar approval could not interpret the planner output for ${plan.sourcePath}.`,
        [plan.recommendedAction],
        [],
      );
  }
}

export function buildSidecarApprovalReview(input: SidecarApprovalReviewInput): SidecarApprovalReview {
  if (input.writePlan) {
    return reviewFromWritePlan(input.writePlan);
  }

  if (input.validationReport) {
    return reviewFromValidationReport(input.validationReport);
  }

  if (input.recommendation) {
    return reviewFromRecommendation(input.recommendation);
  }

  if (input.planner) {
    return reviewFromPlanner(input.planner);
  }

  throw new Error("buildSidecarApprovalReview requires at least one sidecar state.");
}
