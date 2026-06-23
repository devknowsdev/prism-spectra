import {
  PRISM_SIDECAR_SUFFIX,
  type BuildSidecarPlanInput,
  type CreateInitialSidecarInput,
  type PrismLocalFilePlan,
  type PrismSidecar,
  type SidecarHashFieldUpdate,
  type SidecarShapeValidationResult,
} from "./sidecarTypes.js";

export { PRISM_SIDECAR_SUFFIX } from "./sidecarTypes.js";

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0 ? value : null;
}

export function buildSidecarPath(sourcePath: string, suffix: string = PRISM_SIDECAR_SUFFIX): string {
  if (!sourcePath.trim()) {
    throw new Error("buildSidecarPath requires a sourcePath.");
  }

  return `${sourcePath}${suffix}`;
}

export function createInitialSidecar(input: CreateInitialSidecarInput): PrismSidecar {
  if (!input.assetId.trim()) {
    throw new Error("createInitialSidecar requires assetId.");
  }
  if (!input.sourcePath.trim()) {
    throw new Error("createInitialSidecar requires sourcePath.");
  }
  if (!input.canonicalPath.trim()) {
    throw new Error("createInitialSidecar requires canonicalPath.");
  }
  if (!input.kind.trim()) {
    throw new Error("createInitialSidecar requires kind.");
  }

  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;

  return {
    assetId: input.assetId,
    sourcePath: input.sourcePath,
    canonicalPath: input.canonicalPath,
    sha256: input.sha256 ?? "",
    sizeBytes: input.sizeBytes ?? 0,
    createdAt,
    updatedAt,
    kind: input.kind,
    tags: input.tags ? [...input.tags] : [],
    derivedFiles: input.derivedFiles ? [...input.derivedFiles] : [],
    analysisStatus: input.analysisStatus ?? "pending",
    approvalState: input.approvalState ?? "unreviewed",
    notes: input.notes ? [...input.notes] : [],
  };
}

export function validateSidecarShape(value: unknown): SidecarShapeValidationResult {
  if (!isRecord(value)) {
    return { ok: false, sidecar: null, issues: ["not_an_object"] };
  }

  const issues: string[] = [];
  const assetId = readNonEmptyString(value.assetId);
  const sourcePath = readNonEmptyString(value.sourcePath);
  const canonicalPath = readNonEmptyString(value.canonicalPath);
  const sha256 = readString(value.sha256);
  const sizeBytes = readNonNegativeInteger(value.sizeBytes);
  const createdAt = readNonEmptyString(value.createdAt);
  const updatedAt = readNonEmptyString(value.updatedAt);
  const kind = readNonEmptyString(value.kind);
  const analysisStatus = readNonEmptyString(value.analysisStatus);
  const approvalState = readNonEmptyString(value.approvalState);
  const tags = value.tags === undefined ? [] : isStringArray(value.tags) ? value.tags : null;
  const derivedFiles = value.derivedFiles === undefined ? [] : isStringArray(value.derivedFiles) ? value.derivedFiles : null;
  const notes = value.notes === undefined ? [] : isStringArray(value.notes) ? value.notes : null;

  if (!assetId) issues.push("missing_assetId");
  if (!sourcePath) issues.push("missing_sourcePath");
  if (!canonicalPath) issues.push("missing_canonicalPath");
  if (sha256 === null) issues.push("invalid_sha256");
  if (sizeBytes === null) issues.push("invalid_sizeBytes");
  if (!createdAt) issues.push("missing_createdAt");
  if (!updatedAt) issues.push("missing_updatedAt");
  if (!kind) issues.push("missing_kind");
  if (!analysisStatus) issues.push("missing_analysisStatus");
  if (!approvalState) issues.push("missing_approvalState");
  if (tags === null) issues.push("invalid_tags");
  if (derivedFiles === null) issues.push("invalid_derivedFiles");
  if (notes === null) issues.push("invalid_notes");

  if (issues.length > 0 || !assetId || !sourcePath || !canonicalPath || sha256 === null || sizeBytes === null || !createdAt || !updatedAt || !kind || !analysisStatus || !approvalState || tags === null || derivedFiles === null || notes === null) {
    return { ok: false, sidecar: null, issues };
  }

  return {
    ok: true,
    issues: [],
    sidecar: {
      assetId,
      sourcePath,
      canonicalPath,
      sha256,
      sizeBytes,
      createdAt,
      updatedAt,
      kind,
      tags,
      derivedFiles,
      analysisStatus,
      approvalState,
      notes,
    },
  };
}

export function updateSidecarHashFields(sidecar: PrismSidecar, update: SidecarHashFieldUpdate): PrismSidecar {
  if (!Number.isInteger(update.sizeBytes) || update.sizeBytes < 0) {
    throw new Error("updateSidecarHashFields requires a non-negative integer sizeBytes.");
  }
  if (typeof update.sha256 !== "string") {
    throw new Error("updateSidecarHashFields requires a sha256 string.");
  }

  return {
    ...sidecar,
    sha256: update.sha256,
    sizeBytes: update.sizeBytes,
    updatedAt: update.updatedAt ?? nowIso(),
  };
}

export function buildSidecarPlan(
  input: BuildSidecarPlanInput,
  sidecarValue?: unknown,
): PrismLocalFilePlan {
  if (!input.sourcePath.trim()) {
    throw new Error("buildSidecarPlan requires sourcePath.");
  }

  const sidecarPath = input.sidecarPath ?? buildSidecarPath(input.sourcePath, input.sidecarSuffix);

  if (sidecarValue === undefined || sidecarValue === null) {
    return {
      sourcePath: input.sourcePath,
      sidecarPath,
      sidecarStatus: "missing",
      status: "candidate",
      reasons: ["missing_sidecar"],
      sidecar: null,
    };
  }

  const validation = validateSidecarShape(sidecarValue);
  if (!validation.ok || !validation.sidecar) {
    return {
      sourcePath: input.sourcePath,
      sidecarPath,
      sidecarStatus: "invalid",
      status: "blocked",
      reasons: validation.issues,
      sidecar: null,
    };
  }

  if (validation.sidecar.sourcePath !== input.sourcePath) {
    return {
      sourcePath: input.sourcePath,
      sidecarPath,
      sidecarStatus: "invalid",
      status: "blocked",
      reasons: ["source_path_mismatch"],
      sidecar: null,
    };
  }

  return {
    sourcePath: input.sourcePath,
    sidecarPath,
    sidecarStatus: "present",
    status: "ready",
    reasons: [],
    sidecar: validation.sidecar,
  };
}
