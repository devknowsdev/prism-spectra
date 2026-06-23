import type {
  AdapterAction,
  AdapterContext,
  AdapterResult,
  ApprovalContext,
  FilesystemOperationOutput,
} from "../adapters/index.js";
import { buildSidecarPath, updateSidecarHashFields, validateSidecarShape } from "./sidecar.js";
import type { PrismSidecar, SidecarHashFieldUpdate } from "./sidecarTypes.js";
import type { SidecarWriteOperation, SidecarWritePlan } from "./sidecarWritePlan.js";

export type SidecarWriteExecutionStatus = "written" | "blocked" | "skipped" | "failed";

export interface SidecarWriteExecutionResult {
  status: SidecarWriteExecutionStatus;
  operation: SidecarWriteOperation;
  sourcePath: string;
  sidecarPath: string;
  reasons: string[];
  warnings: string[];
}

export interface SidecarWriteExecutorFilesystem {
  execute(action: AdapterAction, context: AdapterContext): Promise<AdapterResult<FilesystemOperationOutput>> | AdapterResult<FilesystemOperationOutput>;
}

export interface SidecarWriteExecutorInput {
  plan: SidecarWritePlan;
  filesystem: SidecarWriteExecutorFilesystem;
  approval?: ApprovalContext;
}

const ALLOWED_UPDATE_PATCH_KEYS = ["sha256", "sizeBytes", "updatedAt"] as const;

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

function cloneWarnings(warnings: string[]): string[] {
  return [...warnings];
}

function cloneReasons(reasons: string[]): string[] {
  return [...reasons];
}

function isApproved(approval?: ApprovalContext): boolean {
  return approval?.granted === true;
}

function isCanonicalAdjacentSidecar(plan: SidecarWritePlan): boolean {
  return plan.sidecarPath === buildSidecarPath(plan.sourcePath);
}

function createFilesystemAction(
  id: string,
  operation: string,
  riskLevel: AdapterAction["riskLevel"],
  input: Record<string, unknown>,
  approvalRequired?: AdapterAction["approvalRequired"],
): AdapterAction {
  return {
    id,
    capabilityId: operation,
    kind: "filesystem",
    operation,
    input,
    riskLevel,
    approvalRequired,
  };
}

function blockedResult(plan: SidecarWritePlan, reasons: string[], warnings: string[] = [], operation: SidecarWriteOperation = "none"): SidecarWriteExecutionResult {
  return {
    status: "blocked",
    operation,
    sourcePath: plan.sourcePath,
    sidecarPath: plan.sidecarPath,
    reasons: cloneReasons(reasons),
    warnings: cloneWarnings(warnings),
  };
}

function skippedResult(plan: SidecarWritePlan, reasons: string[], warnings: string[] = []): SidecarWriteExecutionResult {
  return {
    status: "skipped",
    operation: "none",
    sourcePath: plan.sourcePath,
    sidecarPath: plan.sidecarPath,
    reasons: cloneReasons(reasons),
    warnings: cloneWarnings(warnings),
  };
}

function writtenResult(plan: SidecarWritePlan, reasons: string[], warnings: string[], operation: SidecarWriteOperation): SidecarWriteExecutionResult {
  return {
    status: "written",
    operation,
    sourcePath: plan.sourcePath,
    sidecarPath: plan.sidecarPath,
    reasons: cloneReasons(reasons),
    warnings: cloneWarnings(warnings),
  };
}

function failedResult(plan: SidecarWritePlan, reasons: string[], warnings: string[], operation: SidecarWriteOperation): SidecarWriteExecutionResult {
  return {
    status: "failed",
    operation,
    sourcePath: plan.sourcePath,
    sidecarPath: plan.sidecarPath,
    reasons: cloneReasons(reasons),
    warnings: cloneWarnings(warnings),
  };
}

function adapterErrorCode(result: AdapterResult<FilesystemOperationOutput>): string | null {
  return result.error?.code ?? null;
}

function adapterFailureResult(
  plan: SidecarWritePlan,
  operation: SidecarWriteOperation,
  result: AdapterResult<FilesystemOperationOutput>,
  fallbackReason: string,
): SidecarWriteExecutionResult {
  const code = adapterErrorCode(result);
  const reason = code ?? fallbackReason;
  const blockedCodes = new Set([
    "approval_required",
    "file_not_found",
    "invalid_json",
    "not_a_directory",
    "path_outside_allowed_roots",
    "path_traversal_blocked",
    "symlink_rejected",
    "unsupported_operation",
  ]);

  if (code && blockedCodes.has(code)) {
    return blockedResult(plan, [reason], [result.error?.message ?? "filesystem adapter blocked the write"], operation);
  }

  return failedResult(plan, [reason], [result.error?.message ?? "filesystem adapter failed the write"], operation);
}

function validatePlannedCreate(plan: SidecarWritePlan): { ok: true; json: PrismSidecar } | { ok: false; reasons: string[]; warnings: string[] } {
  if (!plan.json) {
    return { ok: false, reasons: ["create_draft_missing"], warnings: ["planned create write is missing canonical sidecar JSON"] };
  }
  if (!plan.content) {
    return { ok: false, reasons: ["create_content_missing"], warnings: ["planned create write is missing deterministic content"] };
  }

  const expectedContent = stringifySidecar(plan.json);
  if (plan.content !== expectedContent) {
    return {
      ok: false,
      reasons: ["create_content_mismatch"],
      warnings: ["planned create content does not match the canonical JSON serialization"],
    };
  }

  if (!isCanonicalAdjacentSidecar(plan)) {
    return {
      ok: false,
      reasons: ["sidecar_path_mismatch"],
      warnings: ["planned create sidecar path is not the canonical adjacent .prism.json path"],
    };
  }

  return { ok: true, json: cloneSidecar(plan.json) };
}

function validateUpdatePatch(plan: SidecarWritePlan): { ok: true; patch: SidecarHashFieldUpdate } | { ok: false; reasons: string[]; warnings: string[] } {
  if (!plan.patch) {
    return { ok: false, reasons: ["update_patch_missing"], warnings: ["planned update write is missing hash patch fields"] };
  }

  const patchKeys = Object.keys(plan.patch).sort();
  if (patchKeys.length !== ALLOWED_UPDATE_PATCH_KEYS.length || !ALLOWED_UPDATE_PATCH_KEYS.every((key, index) => patchKeys[index] === key)) {
    return {
      ok: false,
      reasons: ["update_patch_invalid"],
      warnings: ["planned update patch must contain only sha256, sizeBytes, and updatedAt"],
    };
  }

  if (typeof plan.patch.sha256 !== "string" || !plan.patch.sha256.trim()) {
    return {
      ok: false,
      reasons: ["update_patch_invalid_sha256"],
      warnings: ["planned update patch sha256 must be a non-empty string"],
    };
  }

  if (typeof plan.patch.sizeBytes !== "number" || !Number.isInteger(plan.patch.sizeBytes) || plan.patch.sizeBytes < 0) {
    return {
      ok: false,
      reasons: ["update_patch_invalid_sizeBytes"],
      warnings: ["planned update patch sizeBytes must be a non-negative integer"],
    };
  }

  if (typeof plan.patch.updatedAt !== "string" || !plan.patch.updatedAt.trim()) {
    return {
      ok: false,
      reasons: ["update_patch_invalid_updatedAt"],
      warnings: ["planned update patch updatedAt must be a non-empty string"],
    };
  }

  if (!isCanonicalAdjacentSidecar(plan)) {
    return {
      ok: false,
      reasons: ["sidecar_path_mismatch"],
      warnings: ["planned update sidecar path is not the canonical adjacent .prism.json path"],
    };
  }

  return {
    ok: true,
    patch: {
      sha256: plan.patch.sha256,
      sizeBytes: plan.patch.sizeBytes,
      updatedAt: plan.patch.updatedAt,
    },
  };
}

async function executeCreateSidecarWrite(input: SidecarWriteExecutorInput): Promise<SidecarWriteExecutionResult> {
  const { plan, filesystem, approval } = input;
  if (!isApproved(approval)) {
    return blockedResult(plan, ["local_write_approval_required"], ["explicit local_write approval is required before writing a sidecar"]);
  }

  const validated = validatePlannedCreate(plan);
  if (!validated.ok) {
    return blockedResult(plan, validated.reasons, validated.warnings, "create_sidecar");
  }

  const action = createFilesystemAction(
    "sidecar-write-create",
    "writeJsonFile",
    "local_write",
    { path: plan.sidecarPath, data: validated.json },
    "required",
  );

  const result = await filesystem.execute(action, { approval });
  if (!result.success) {
    return adapterFailureResult(plan, "create_sidecar", result, "sidecar_create_failed");
  }

  return writtenResult(plan, cloneReasons(plan.reasons), cloneWarnings(plan.warnings), "create_sidecar");
}

async function executeUpdateSidecarWrite(input: SidecarWriteExecutorInput): Promise<SidecarWriteExecutionResult> {
  const { plan, filesystem, approval } = input;
  if (!isApproved(approval)) {
    return blockedResult(plan, ["local_write_approval_required"], ["explicit local_write approval is required before updating a sidecar"]);
  }

  const validatedPatch = validateUpdatePatch(plan);
  if (!validatedPatch.ok) {
    return blockedResult(plan, validatedPatch.reasons, validatedPatch.warnings, "update_sidecar");
  }

  const readAction = createFilesystemAction("sidecar-write-read", "readJsonFile", "read_only", { path: plan.sidecarPath });
  const readResult = await filesystem.execute(readAction, {});
  if (!readResult.success || !readResult.output || readResult.output.operation !== "readJsonFile") {
    return adapterFailureResult(plan, "update_sidecar", readResult, "sidecar_read_failed");
  }

  const validation = validateSidecarShape(readResult.output.data);
  if (!validation.ok || !validation.sidecar) {
    return blockedResult(
      plan,
      validation.issues.length > 0 ? validation.issues : ["sidecar_shape_invalid"],
      ["current sidecar could not be validated before applying the patch"],
      "update_sidecar",
    );
  }

  if (validation.sidecar.sourcePath !== plan.sourcePath) {
    return blockedResult(
      plan,
      ["source_path_mismatch"],
      ["current sidecar sourcePath no longer matches the requested source path"],
      "update_sidecar",
    );
  }

  const updatedSidecar = updateSidecarHashFields(validation.sidecar, validatedPatch.patch);
  const writeAction = createFilesystemAction(
    "sidecar-write-update",
    "writeJsonFile",
    "local_write",
    { path: plan.sidecarPath, data: updatedSidecar },
    "required",
  );

  const writeResult = await filesystem.execute(writeAction, { approval });
  if (!writeResult.success) {
    return adapterFailureResult(plan, "update_sidecar", writeResult, "sidecar_update_failed");
  }

  return writtenResult(plan, cloneReasons(plan.reasons), cloneWarnings(plan.warnings), "update_sidecar");
}

export async function executeSidecarWritePlan(input: SidecarWriteExecutorInput): Promise<SidecarWriteExecutionResult> {
  const { plan } = input;

  if (plan.status === "not_applicable") {
    return skippedResult(plan, cloneReasons(plan.reasons), cloneWarnings(plan.warnings));
  }

  if (plan.status === "blocked") {
    return blockedResult(plan, cloneReasons(plan.reasons), cloneWarnings(plan.warnings));
  }

  try {
    switch (plan.operation) {
      case "create_sidecar":
        return await executeCreateSidecarWrite(input);
      case "update_sidecar":
        return await executeUpdateSidecarWrite(input);
      case "none":
        return blockedResult(plan, ["unsupported_write_plan_operation"], ["write execution requires a planned sidecar write operation"]);
      default:
        return blockedResult(plan, ["unsupported_write_plan_state"], [`unsupported sidecar write plan operation: ${(plan as { operation?: string }).operation ?? "unknown"}`]);
    }
  } catch (error) {
    return failedResult(
      plan,
      ["executor_exception"],
      [error instanceof Error && error.message ? error.message : String(error)],
      plan.operation,
    );
  }
}
