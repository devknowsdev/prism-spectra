import { createInitialSidecar, updateSidecarHashFields } from "./sidecar.js";
import type { LocalFileRoundTripPlan, LocalFileRoundTripSourceFacts } from "./localFileRoundTripPlanner.js";
import type { PrismSidecar } from "./sidecarTypes.js";

export type SidecarRecommendationAction =
  | "create_sidecar"
  | "update_sidecar_hash"
  | "review_sidecar"
  | "ready"
  | "blocked";

export interface SidecarRecommendation {
  action: SidecarRecommendationAction;
  reason: string;
  sidecarPath: string;
  sourcePath: string;
  draft?: PrismSidecar;
  patch?: Partial<PrismSidecar>;
  warnings: string[];
}

export interface SidecarRecommendationOptions {
  now?: () => string;
}

function currentIso(now: () => string): string {
  return now();
}

function deterministicAssetIdForSourcePath(sourcePath: string): string {
  const normalized = sourcePath.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `asset-${normalized || "source"}`;
}

function createRecommendedSidecarDraft(sourcePath: string, sourceFacts: LocalFileRoundTripSourceFacts, timestamp: string): PrismSidecar {
  return createInitialSidecar({
    assetId: deterministicAssetIdForSourcePath(sourcePath),
    sourcePath,
    canonicalPath: sourcePath,
    sha256: sourceFacts.sha256,
    sizeBytes: sourceFacts.sizeBytes,
    createdAt: timestamp,
    updatedAt: timestamp,
    kind: "other",
    tags: [],
    derivedFiles: [],
    analysisStatus: "pending",
    approvalState: "unreviewed",
    notes: [],
  });
}

function updateHashPatch(sidecar: PrismSidecar, sourceFacts: LocalFileRoundTripSourceFacts, timestamp: string): Partial<PrismSidecar> {
  const updated = updateSidecarHashFields({ ...sidecar }, {
    sha256: sourceFacts.sha256,
    sizeBytes: sourceFacts.sizeBytes,
    updatedAt: timestamp,
  });

  return {
    sha256: updated.sha256,
    sizeBytes: updated.sizeBytes,
    updatedAt: updated.updatedAt,
  };
}

function blockedRecommendation(plan: LocalFileRoundTripPlan, reason: string, warnings: string[]): SidecarRecommendation {
  return {
    action: "blocked",
    reason,
    sidecarPath: plan.sidecarPath,
    sourcePath: plan.sourcePath,
    warnings,
  };
}

export function recommendSidecarAction(
  plan: LocalFileRoundTripPlan,
  options: SidecarRecommendationOptions = {},
): SidecarRecommendation {
  const now = options.now ?? (() => new Date().toISOString());
  const timestamp = currentIso(now);

  if (plan.sourceStatus === "missing") {
    return blockedRecommendation(plan, "source_missing", ["source file is missing; no sidecar draft can be recommended"]);
  }

  if (plan.sourceStatus === "blocked") {
    return blockedRecommendation(plan, "source_blocked", plan.reasons.length > 0 ? [...plan.reasons] : ["source is blocked by the planner"]);
  }

  switch (plan.sidecarStatus) {
    case "missing": {
      if (!plan.sourceFacts) {
        return blockedRecommendation(plan, "source_facts_missing", ["source facts are required before a draft can be recommended"]);
      }

      return {
        action: "create_sidecar",
        reason: "sidecar_missing",
        sidecarPath: plan.sidecarPath,
        sourcePath: plan.sourcePath,
        draft: createRecommendedSidecarDraft(plan.sourcePath, plan.sourceFacts, timestamp),
        warnings: [],
      };
    }

    case "stale": {
      if (!plan.sourceFacts || !plan.sidecar) {
        return blockedRecommendation(plan, "source_facts_missing", ["source facts and an existing sidecar are required to recommend a hash update"]);
      }

      return {
        action: "update_sidecar_hash",
        reason: "sidecar_stale",
        sidecarPath: plan.sidecarPath,
        sourcePath: plan.sourcePath,
        patch: updateHashPatch(plan.sidecar, plan.sourceFacts, timestamp),
        warnings: [],
      };
    }

    case "valid":
      return {
        action: "ready",
        reason: "sidecar_ready",
        sidecarPath: plan.sidecarPath,
        sourcePath: plan.sourcePath,
        warnings: [],
      };

    case "malformed":
      return {
        action: "review_sidecar",
        reason: "sidecar_malformed",
        sidecarPath: plan.sidecarPath,
        sourcePath: plan.sourcePath,
        warnings: ["sidecar JSON could not be parsed or validated"],
      };

    case "mismatched_source":
      return {
        action: "review_sidecar",
        reason: "source_path_mismatch",
        sidecarPath: plan.sidecarPath,
        sourcePath: plan.sourcePath,
        warnings: ["sidecar sourcePath does not match the requested source path"],
      };

    case "blocked":
      return blockedRecommendation(
        plan,
        "sidecar_blocked",
        plan.reasons.length > 0 ? [...plan.reasons] : ["planner returned a blocked sidecar state"],
      );

    default:
      return blockedRecommendation(plan, "unsupported_plan_state", [`unsupported sidecar status: ${(plan as { sidecarStatus?: string }).sidecarStatus ?? "unknown"}`]);
  }
}
