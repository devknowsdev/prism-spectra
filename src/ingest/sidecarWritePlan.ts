import type { PrismSidecar } from "./sidecarTypes.js";
import type { SidecarRecommendation } from "./sidecarRecommendation.js";

export type SidecarWritePlanStatus = "planned" | "not_applicable" | "blocked";
export type SidecarWriteOperation = "create_sidecar" | "update_sidecar" | "none";
export type SidecarWriteApprovalType = "local_write" | "none";

export interface SidecarWritePlan {
  status: SidecarWritePlanStatus;
  operation: SidecarWriteOperation;
  approvalType: SidecarWriteApprovalType;
  sourcePath: string;
  sidecarPath: string;
  content?: string;
  json?: PrismSidecar;
  patch?: Partial<PrismSidecar>;
  reasons: string[];
  warnings: string[];
  safetyChecks: string[];
}

function cloneSidecar(sidecar: PrismSidecar): PrismSidecar {
  return {
    assetId: sidecar.assetId,
    sourcePath: sidecar.sourcePath,
    canonicalPath: sidecar.canonicalPath,
    sha256: sidecar.sha256,
    sizeBytes: sidecar.sizeBytes,
    createdAt: sidecar.createdAt,
    updatedAt: sidecar.updatedAt,
    kind: sidecar.kind,
    tags: [...sidecar.tags],
    derivedFiles: [...sidecar.derivedFiles],
    analysisStatus: sidecar.analysisStatus,
    approvalState: sidecar.approvalState,
    notes: [...sidecar.notes],
  };
}

function stringifySidecar(sidecar: PrismSidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

function createPlannedWrite(
  recommendation: SidecarRecommendation,
  content: string,
  json: PrismSidecar,
  safetyChecks: string[],
): SidecarWritePlan {
  return {
    status: "planned",
    operation: recommendation.action === "update_sidecar_hash" ? "update_sidecar" : "create_sidecar",
    approvalType: "local_write",
    sourcePath: recommendation.sourcePath,
    sidecarPath: recommendation.sidecarPath,
    content,
    json,
    patch: recommendation.action === "update_sidecar_hash" ? { ...recommendation.patch } : undefined,
    reasons: [recommendation.reason],
    warnings: [...recommendation.warnings],
    safetyChecks,
  };
}

function blockedWritePlan(recommendation: SidecarRecommendation, reason: string, warnings: string[]): SidecarWritePlan {
  return {
    status: "blocked",
    operation: "none",
    approvalType: "none",
    sourcePath: recommendation.sourcePath,
    sidecarPath: recommendation.sidecarPath,
    reasons: [reason],
    warnings,
    safetyChecks: [],
  };
}

function plannedCreateWrite(recommendation: SidecarRecommendation): SidecarWritePlan | null {
  if (recommendation.action !== "create_sidecar" || !recommendation.draft) {
    return null;
  }

  const json = cloneSidecar(recommendation.draft);
  return createPlannedWrite(recommendation, stringifySidecar(json), json, [
    "sidecar path must remain inside allowed roots",
    "parent/source relationship must be revalidated before write",
    "existing sidecar must not be overwritten without a later explicit approval mode",
  ]);
}

function plannedUpdateWrite(recommendation: SidecarRecommendation): SidecarWritePlan | null {
  if (recommendation.action !== "update_sidecar_hash" || !recommendation.patch) {
    return null;
  }

  const json = recommendation.draft ? cloneSidecar(recommendation.draft) : undefined;
  return {
    status: "planned",
    operation: "update_sidecar",
    approvalType: "local_write",
    sourcePath: recommendation.sourcePath,
    sidecarPath: recommendation.sidecarPath,
    json,
    patch: { ...recommendation.patch },
    reasons: [recommendation.reason],
    warnings: [...recommendation.warnings],
    safetyChecks: [
      "sidecar path must remain inside allowed roots",
      "sidecar must be re-read before write",
      "current sidecar sourcePath must still match requested sourcePath",
      "stale fields must be revalidated before write",
    ],
  };
}

export function planSidecarWrite(recommendation: SidecarRecommendation): SidecarWritePlan {
  const plannedCreate = plannedCreateWrite(recommendation);
  if (plannedCreate) {
    return plannedCreate;
  }

  const plannedUpdate = plannedUpdateWrite(recommendation);
  if (plannedUpdate) {
    return plannedUpdate;
  }

  switch (recommendation.action) {
    case "ready":
      return {
        status: "not_applicable",
        operation: "none",
        approvalType: "none",
        sourcePath: recommendation.sourcePath,
        sidecarPath: recommendation.sidecarPath,
        reasons: [recommendation.reason],
        warnings: [...recommendation.warnings],
        safetyChecks: [],
      };

    case "review_sidecar":
      return blockedWritePlan(recommendation, recommendation.reason, [...recommendation.warnings]);

    case "blocked":
      return blockedWritePlan(recommendation, recommendation.reason, [...recommendation.warnings]);

    default:
      return blockedWritePlan(recommendation, "unsupported_recommendation_state", [
        ...recommendation.warnings,
        `unsupported recommendation action: ${recommendation.action}`,
      ]);
  }
}
