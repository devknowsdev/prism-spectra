export const PRISM_SIDECAR_SUFFIX = ".prism.json" as const;

export type PrismSidecarStatus = "missing" | "present" | "invalid";
export type PrismLocalFilePlanStatus = "candidate" | "ready" | "blocked";

export interface PrismSidecar {
  assetId: string;
  sourcePath: string;
  canonicalPath: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  kind: string;
  tags: string[];
  derivedFiles: string[];
  analysisStatus: string;
  approvalState: string;
  notes: string[];
}

export interface CreateInitialSidecarInput {
  assetId: string;
  sourcePath: string;
  canonicalPath: string;
  kind: string;
  sha256?: string;
  sizeBytes?: number;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
  derivedFiles?: string[];
  analysisStatus?: string;
  approvalState?: string;
  notes?: string[];
}

export interface SidecarHashFieldUpdate {
  sha256: string;
  sizeBytes: number;
  updatedAt?: string;
}

export interface SidecarShapeValidationResult {
  ok: boolean;
  sidecar: PrismSidecar | null;
  issues: string[];
}

export interface BuildSidecarPlanInput {
  sourcePath: string;
  sidecarPath?: string;
  sidecarSuffix?: string;
}

export interface PrismLocalFilePlan {
  sourcePath: string;
  sidecarPath: string;
  sidecarStatus: PrismSidecarStatus;
  status: PrismLocalFilePlanStatus;
  reasons: string[];
  sidecar: PrismSidecar | null;
}
