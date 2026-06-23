import { buildSidecarPath, validateSidecarShape } from "./sidecar.js";
import { PRISM_SIDECAR_SUFFIX, type PrismSidecar } from "./sidecarTypes.js";

export type LocalFileRoundTripSourceStatus = "missing" | "present" | "blocked";
export type LocalFileRoundTripSidecarStatus =
  | "missing"
  | "valid"
  | "malformed"
  | "mismatched_source"
  | "stale"
  | "blocked";
export type LocalFileRoundTripRecommendedAction = "create_sidecar" | "update_sidecar_hash" | "review_sidecar" | "ready" | "blocked";

export interface LocalFileRoundTripSourceFacts {
  sizeBytes: number;
  sha256: string;
}

export interface LocalFileRoundTripStat {
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
}

export interface LocalFileRoundTripFilesystem {
  statPath(path: string): Promise<LocalFileRoundTripStat>;
  readTextFile(path: string): Promise<string>;
  computeSha256(path: string): Promise<string>;
}

export interface LocalFileRoundTripPlanInput {
  sourcePath: string;
  filesystem: LocalFileRoundTripFilesystem;
  sidecarSuffix?: string;
}

export interface LocalFileRoundTripPlan {
  sourcePath: string;
  sidecarPath: string;
  sourceStatus: LocalFileRoundTripSourceStatus;
  sidecarStatus: LocalFileRoundTripSidecarStatus;
  sourceFacts: LocalFileRoundTripSourceFacts | null;
  sidecar: PrismSidecar | null;
  reasons: string[];
  recommendedAction: LocalFileRoundTripRecommendedAction;
}

function isFileStat(stat: LocalFileRoundTripStat): boolean {
  return stat.kind === "file";
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function blockedPlan(sourcePath: string, sidecarPath: string, reasons: string[]): LocalFileRoundTripPlan {
  return {
    sourcePath,
    sidecarPath,
    sourceStatus: "blocked",
    sidecarStatus: "blocked",
    sourceFacts: null,
    sidecar: null,
    reasons,
    recommendedAction: "blocked",
  };
}

function missingSourcePlan(sourcePath: string, sidecarPath: string): LocalFileRoundTripPlan {
  return {
    sourcePath,
    sidecarPath,
    sourceStatus: "missing",
    sidecarStatus: "blocked",
    sourceFacts: null,
    sidecar: null,
    reasons: ["source_missing"],
    recommendedAction: "blocked",
  };
}

function missingSidecarPlan(
  sourcePath: string,
  sidecarPath: string,
  sourceFacts: LocalFileRoundTripSourceFacts,
): LocalFileRoundTripPlan {
  return {
    sourcePath,
    sidecarPath,
    sourceStatus: "present",
    sidecarStatus: "missing",
    sourceFacts,
    sidecar: null,
    reasons: ["sidecar_missing"],
    recommendedAction: "create_sidecar",
  };
}

function malformedPlan(
  sourcePath: string,
  sidecarPath: string,
  sourceFacts: LocalFileRoundTripSourceFacts,
  reasons: string[],
): LocalFileRoundTripPlan {
  return {
    sourcePath,
    sidecarPath,
    sourceStatus: "present",
    sidecarStatus: "malformed",
    sourceFacts,
    sidecar: null,
    reasons,
    recommendedAction: "review_sidecar",
  };
}

function mismatchedSourcePlan(
  sourcePath: string,
  sidecarPath: string,
  sourceFacts: LocalFileRoundTripSourceFacts,
  sidecar: PrismSidecar,
): LocalFileRoundTripPlan {
  return {
    sourcePath,
    sidecarPath,
    sourceStatus: "present",
    sidecarStatus: "mismatched_source",
    sourceFacts,
    sidecar,
    reasons: ["source_path_mismatch"],
    recommendedAction: "review_sidecar",
  };
}

function stalePlan(
  sourcePath: string,
  sidecarPath: string,
  sourceFacts: LocalFileRoundTripSourceFacts,
  sidecar: PrismSidecar,
  reasons: string[],
): LocalFileRoundTripPlan {
  return {
    sourcePath,
    sidecarPath,
    sourceStatus: "present",
    sidecarStatus: "stale",
    sourceFacts,
    sidecar,
    reasons,
    recommendedAction: "update_sidecar_hash",
  };
}

function readyPlan(
  sourcePath: string,
  sidecarPath: string,
  sourceFacts: LocalFileRoundTripSourceFacts,
  sidecar: PrismSidecar,
): LocalFileRoundTripPlan {
  return {
    sourcePath,
    sidecarPath,
    sourceStatus: "present",
    sidecarStatus: "valid",
    sourceFacts,
    sidecar,
    reasons: [],
    recommendedAction: "ready",
  };
}

export async function planLocalFileRoundTrip(input: LocalFileRoundTripPlanInput): Promise<LocalFileRoundTripPlan> {
  const sourcePath = input.sourcePath.trim();
  if (!sourcePath) {
    throw new Error("planLocalFileRoundTrip requires sourcePath.");
  }

  const sidecarPath = buildSidecarPath(sourcePath, input.sidecarSuffix ?? PRISM_SIDECAR_SUFFIX);

  let sourceStat: LocalFileRoundTripStat;
  try {
    sourceStat = await input.filesystem.statPath(sourcePath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "file_not_found") {
      return missingSourcePlan(sourcePath, sidecarPath);
    }
    return blockedPlan(sourcePath, sidecarPath, ["source_blocked", code ?? "source_stat_failed"]);
  }

  if (!isFileStat(sourceStat)) {
    return blockedPlan(sourcePath, sidecarPath, ["source_not_file"]);
  }

  let sourceSha256: string;
  try {
    sourceSha256 = await input.filesystem.computeSha256(sourcePath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "file_not_found") {
      return missingSourcePlan(sourcePath, sidecarPath);
    }
    return blockedPlan(sourcePath, sidecarPath, ["source_blocked", code ?? "source_hash_failed"]);
  }

  const sourceFacts: LocalFileRoundTripSourceFacts = {
    sizeBytes: sourceStat.size,
    sha256: sourceSha256,
  };

  let sidecarStat: LocalFileRoundTripStat;
  try {
    sidecarStat = await input.filesystem.statPath(sidecarPath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "file_not_found") {
      return missingSidecarPlan(sourcePath, sidecarPath, sourceFacts);
    }
    return blockedPlan(sourcePath, sidecarPath, ["sidecar_blocked", code ?? "sidecar_stat_failed"]);
  }

  if (!isFileStat(sidecarStat)) {
    return blockedPlan(sourcePath, sidecarPath, ["sidecar_not_file"]);
  }

  let sidecarText: string;
  try {
    sidecarText = await input.filesystem.readTextFile(sidecarPath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "file_not_found") {
      return missingSidecarPlan(sourcePath, sidecarPath, sourceFacts);
    }
    return blockedPlan(sourcePath, sidecarPath, ["sidecar_blocked", code ?? "sidecar_read_failed"]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sidecarText);
  } catch (error) {
    return malformedPlan(sourcePath, sidecarPath, sourceFacts, [
      "sidecar_json_malformed",
      error instanceof Error && error.message ? error.message : "json_parse_failed",
    ]);
  }

  const validation = validateSidecarShape(parsed);
  if (!validation.ok || !validation.sidecar) {
    return malformedPlan(sourcePath, sidecarPath, sourceFacts, validation.issues.length > 0 ? validation.issues : ["sidecar_shape_invalid"]);
  }

  if (validation.sidecar.sourcePath !== sourcePath) {
    return mismatchedSourcePlan(sourcePath, sidecarPath, sourceFacts, validation.sidecar);
  }

  const staleReasons: string[] = [];
  if (validation.sidecar.sha256 !== sourceFacts.sha256) {
    staleReasons.push("sha256_mismatch");
  }
  if (validation.sidecar.sizeBytes !== sourceFacts.sizeBytes) {
    staleReasons.push("sizeBytes_mismatch");
  }

  if (staleReasons.length > 0) {
    return stalePlan(sourcePath, sidecarPath, sourceFacts, validation.sidecar, staleReasons);
  }

  return readyPlan(sourcePath, sidecarPath, sourceFacts, validation.sidecar);
}
