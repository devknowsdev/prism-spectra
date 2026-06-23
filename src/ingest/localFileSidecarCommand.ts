import type {
  AdapterAction,
  AdapterContext,
  AdapterContract,
  AdapterResult,
  ApprovalContext,
  FilesystemOperationOutput,
} from "../adapters/index.js";
import { PRISM_SIDECAR_SUFFIX } from "./sidecarTypes.js";
import { planLocalFileRoundTrip, type LocalFileRoundTripFilesystem, type LocalFileRoundTripPlan } from "./localFileRoundTripPlanner.js";
import { recommendSidecarAction, type SidecarRecommendation } from "./sidecarRecommendation.js";
import { executeSidecarWritePlan, type SidecarWriteExecutionResult } from "./sidecarWriteExecutor.js";
import { planSidecarWrite, type SidecarWritePlan } from "./sidecarWritePlan.js";

export type LocalFileSidecarCommandMode = "plan_only" | "execute_approved";
export type LocalFileSidecarCommandStatus = "planned" | "written" | "skipped" | "blocked" | "failed";

export interface LocalFileSidecarCommandInput {
  mode: LocalFileSidecarCommandMode;
  sourcePath: string;
  filesystemAdapter: AdapterContract<FilesystemOperationOutput>;
  approval?: ApprovalContext;
  sidecarSuffix?: string;
}

export interface LocalFileSidecarCommandResult {
  mode: LocalFileSidecarCommandMode;
  sourcePath: string;
  sidecarPath: string;
  planner: LocalFileRoundTripPlan;
  recommendation: SidecarRecommendation;
  writePlan: SidecarWritePlan;
  execution?: SidecarWriteExecutionResult;
  status: LocalFileSidecarCommandStatus;
  reasons: string[];
  warnings: string[];
}

function commandSidecarPath(sourcePath: string, sidecarSuffix: string = PRISM_SIDECAR_SUFFIX): string {
  const trimmed = sourcePath.trim();
  return trimmed.length > 0 ? `${trimmed}${sidecarSuffix}` : sidecarSuffix;
}

function createFilesystemAction(
  id: string,
  operation: string,
  riskLevel: AdapterAction["riskLevel"],
  input: Record<string, unknown>,
): AdapterAction {
  return {
    id,
    capabilityId: operation,
    kind: "filesystem",
    operation,
    input,
    riskLevel,
  };
}

function createPlannerFilesystem(adapter: AdapterContract<FilesystemOperationOutput>): LocalFileRoundTripFilesystem {
  let sequence = 0;

  async function runOperation(
    operation: "statPath" | "readTextFile" | "computeSha256",
    input: Record<string, unknown>,
  ): Promise<AdapterResult<FilesystemOperationOutput>> {
    return adapter.execute(createFilesystemAction(`local-file-sidecar-${sequence++}`, operation, "read_only", input), {});
  }

  function unwrapResult<T extends FilesystemOperationOutput["operation"]>(
    result: AdapterResult<FilesystemOperationOutput>,
    expected: T,
  ): Extract<FilesystemOperationOutput, { operation: T }> {
    if (!result.success || !result.output) {
      const error = new Error(result.error?.message ?? `${expected} failed`);
      (error as { code?: string }).code = result.error?.code;
      (error as { details?: unknown }).details = result.error?.details;
      throw error;
    }

    if (result.output.operation !== expected) {
      throw new Error(`Unexpected filesystem output for ${expected}.`);
    }

    return result.output as Extract<FilesystemOperationOutput, { operation: T }>;
  }

  return {
    async statPath(path: string) {
      const result = await runOperation("statPath", { path });
      const output = unwrapResult(result, "statPath");
      return { kind: output.stat.kind, size: output.stat.size };
    },
    async readTextFile(path: string) {
      const result = await runOperation("readTextFile", { path });
      return unwrapResult(result, "readTextFile").content;
    },
    async computeSha256(path: string) {
      const result = await runOperation("computeSha256", { path });
      return unwrapResult(result, "computeSha256").sha256;
    },
  };
}

function createBlockedResult(
  mode: LocalFileSidecarCommandMode,
  sourcePath: string,
  sidecarPath: string,
  planner: LocalFileRoundTripPlan,
  recommendation: SidecarRecommendation,
  writePlan: SidecarWritePlan,
  reasons: string[],
  warnings: string[],
): LocalFileSidecarCommandResult {
  return {
    mode,
    sourcePath,
    sidecarPath,
    planner,
    recommendation,
    writePlan,
    status: "blocked",
    reasons: [...reasons],
    warnings: [...warnings],
  };
}

function createSkippedResult(
  mode: LocalFileSidecarCommandMode,
  sourcePath: string,
  sidecarPath: string,
  planner: LocalFileRoundTripPlan,
  recommendation: SidecarRecommendation,
  writePlan: SidecarWritePlan,
  reasons: string[],
  warnings: string[],
): LocalFileSidecarCommandResult {
  return {
    mode,
    sourcePath,
    sidecarPath,
    planner,
    recommendation,
    writePlan,
    status: "skipped",
    reasons: [...reasons],
    warnings: [...warnings],
  };
}

function createPlannedResult(
  mode: LocalFileSidecarCommandMode,
  sourcePath: string,
  sidecarPath: string,
  planner: LocalFileRoundTripPlan,
  recommendation: SidecarRecommendation,
  writePlan: SidecarWritePlan,
): LocalFileSidecarCommandResult {
  return {
    mode,
    sourcePath,
    sidecarPath,
    planner,
    recommendation,
    writePlan,
    status: "planned",
    reasons: [...writePlan.reasons],
    warnings: [...writePlan.warnings],
  };
}

function createFailedCommandResult(
  mode: LocalFileSidecarCommandMode,
  sourcePath: string,
  sidecarPath: string,
  planner: LocalFileRoundTripPlan,
  recommendation: SidecarRecommendation,
  writePlan: SidecarWritePlan,
  message: string,
): LocalFileSidecarCommandResult {
  return {
    mode,
    sourcePath,
    sidecarPath,
    planner,
    recommendation,
    writePlan,
    status: "failed",
    reasons: ["command_failed"],
    warnings: [message],
  };
}

function blockedPlannerFallback(sourcePath: string, sidecarPath: string): LocalFileRoundTripPlan {
  return {
    sourcePath,
    sidecarPath,
    sourceStatus: "blocked",
    sidecarStatus: "blocked",
    sourceFacts: null,
    sidecar: null,
    reasons: ["command_failed"],
    recommendedAction: "blocked",
  };
}

function blockedRecommendationFallback(sourcePath: string, sidecarPath: string, message: string): SidecarRecommendation {
  return {
    action: "blocked",
    reason: "command_failed",
    sourcePath,
    sidecarPath,
    warnings: [message],
  };
}

function blockedWritePlanFallback(sourcePath: string, sidecarPath: string, reason: string, warning: string): SidecarWritePlan {
  return {
    status: "blocked",
    operation: "none",
    approvalType: "none",
    sourcePath,
    sidecarPath,
    reasons: [reason],
    warnings: [warning],
    safetyChecks: [],
  };
}

export async function runLocalFileSidecarCommand(input: LocalFileSidecarCommandInput): Promise<LocalFileSidecarCommandResult> {
  const sourcePath = input.sourcePath.trim();
  const sidecarPath = commandSidecarPath(sourcePath, input.sidecarSuffix ?? PRISM_SIDECAR_SUFFIX);

  let planner: LocalFileRoundTripPlan | undefined;
  let recommendation: SidecarRecommendation | undefined;
  let writePlan: SidecarWritePlan | undefined;

  try {
    planner = await planLocalFileRoundTrip({
      sourcePath: input.sourcePath,
      filesystem: createPlannerFilesystem(input.filesystemAdapter),
      sidecarSuffix: input.sidecarSuffix,
    });
    recommendation = recommendSidecarAction(planner);
    writePlan = planSidecarWrite(recommendation);

    if (input.mode === "plan_only") {
      switch (writePlan.status) {
        case "planned":
          return createPlannedResult(input.mode, planner.sourcePath, planner.sidecarPath, planner, recommendation, writePlan);
        case "not_applicable":
          return createSkippedResult(input.mode, planner.sourcePath, planner.sidecarPath, planner, recommendation, writePlan, writePlan.reasons, writePlan.warnings);
        case "blocked":
          return createBlockedResult(input.mode, planner.sourcePath, planner.sidecarPath, planner, recommendation, writePlan, writePlan.reasons, writePlan.warnings);
      }
    }

    if (writePlan.status === "blocked") {
      return createBlockedResult(input.mode, planner.sourcePath, planner.sidecarPath, planner, recommendation, writePlan, writePlan.reasons, writePlan.warnings);
    }

    if (writePlan.status === "not_applicable") {
      return createSkippedResult(input.mode, planner.sourcePath, planner.sidecarPath, planner, recommendation, writePlan, writePlan.reasons, writePlan.warnings);
    }

    if (!input.approval?.granted) {
      return createBlockedResult(
        input.mode,
        planner.sourcePath,
        planner.sidecarPath,
        planner,
        recommendation,
        writePlan,
        [...writePlan.reasons, "local_write_approval_required"],
        [...writePlan.warnings],
      );
    }

    const execution = await executeSidecarWritePlan({
      plan: writePlan,
      filesystem: input.filesystemAdapter,
      approval: input.approval,
    });

    if (execution.status === "written") {
      return {
        mode: input.mode,
        sourcePath: planner.sourcePath,
        sidecarPath: planner.sidecarPath,
        planner,
        recommendation,
        writePlan,
        execution,
        status: "written",
        reasons: [...execution.reasons],
        warnings: [...execution.warnings],
      };
    }

    if (execution.status === "skipped") {
      return createSkippedResult(input.mode, planner.sourcePath, planner.sidecarPath, planner, recommendation, writePlan, execution.reasons, execution.warnings);
    }

    if (execution.status === "blocked") {
      return createBlockedResult(input.mode, planner.sourcePath, planner.sidecarPath, planner, recommendation, writePlan, execution.reasons, execution.warnings);
    }

    return {
      mode: input.mode,
      sourcePath: planner.sourcePath,
      sidecarPath: planner.sidecarPath,
      planner,
      recommendation,
      writePlan,
      execution,
      status: "failed",
      reasons: [...execution.reasons],
      warnings: [...execution.warnings],
    };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error);
    const plannerFallback = planner ?? blockedPlannerFallback(sourcePath, sidecarPath);
    const recommendationFallback = recommendation ?? blockedRecommendationFallback(plannerFallback.sourcePath, plannerFallback.sidecarPath, message);
    const writePlanFallback =
      writePlan ?? blockedWritePlanFallback(plannerFallback.sourcePath, plannerFallback.sidecarPath, recommendationFallback.reason, message);

    return createFailedCommandResult(
      input.mode,
      plannerFallback.sourcePath,
      plannerFallback.sidecarPath,
      plannerFallback,
      recommendationFallback,
      writePlanFallback,
      message,
    );
  }
}
