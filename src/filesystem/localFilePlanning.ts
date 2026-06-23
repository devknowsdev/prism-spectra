import {
  PRISM_SIDECAR_SUFFIX,
  buildSidecarPath,
  buildSidecarPlan,
  createInitialSidecar,
  updateSidecarHashFields,
  validateSidecarShape,
  type BuildSidecarPlanInput,
  type CreateInitialSidecarInput,
  type PrismLocalFilePlan,
  type PrismLocalFilePlanStatus,
  type PrismSidecar,
  type PrismSidecarStatus,
  type SidecarHashFieldUpdate,
  type SidecarShapeValidationResult,
} from "../ingest/index.js";

export { PRISM_SIDECAR_SUFFIX };

export type PrismSidecarMetadata = PrismSidecar;
export type PrismSidecarDraft = Partial<CreateInitialSidecarInput>;
export type PrismSidecarValidationResult = SidecarShapeValidationResult;
export type PrismLocalFilePlanInput = BuildSidecarPlanInput;

export function prismSidecarPathFor(sourcePath: string, suffix: string = PRISM_SIDECAR_SUFFIX): string {
  return buildSidecarPath(sourcePath, suffix);
}

export function createPrismSidecarDraft(sourcePath: string, draft: PrismSidecarDraft = {}): PrismSidecar {
  return createInitialSidecar({
    ...draft,
    sourcePath,
  } as CreateInitialSidecarInput);
}

export function validatePrismSidecarMetadata(value: unknown): PrismSidecarValidationResult {
  return validateSidecarShape(value);
}

export function buildPrismLocalFilePlan(
  input: PrismLocalFilePlanInput,
  sidecarValue?: unknown,
): PrismLocalFilePlan {
  return buildSidecarPlan(input, sidecarValue);
}

export { updateSidecarHashFields };

export type {
  PrismLocalFilePlan,
  PrismLocalFilePlanStatus,
  PrismSidecarStatus,
  SidecarHashFieldUpdate,
};
