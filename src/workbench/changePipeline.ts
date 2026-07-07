import type { PrismEventLedger } from "../events/ledger.js";
import { runsClean, type ValidationOutcome } from "../safety/validation.js";

export const WORKBENCH_PIPELINE_TARGET = "workbench";

export interface WorkbenchChangePipelineConfig {
  validate?: string;
  reloadOnValidationFailure?: boolean;
}

export interface WorkbenchChangePipelineOptions {
  config?: WorkbenchChangePipelineConfig;
  eventLedger: PrismEventLedger;
  emitReload: () => void;
  workDir: string;
  runsCleanFn?: (command: string, cwd: string) => Promise<ValidationOutcome>;
}

export interface WorkbenchChangePipelineResult {
  validated: boolean;
  passed?: boolean;
  reloaded: boolean;
  reason?: string;
}

export async function handleWorkbenchChangePipeline(
  options: WorkbenchChangePipelineOptions,
): Promise<WorkbenchChangePipelineResult> {
  const command = options.config?.validate?.trim();
  if (!command) {
    options.emitReload();
    return { validated: false, reloaded: true };
  }

  options.eventLedger.append({
    type: "pipeline.change.detected",
    summary: "Workbench change detected",
    severity: "info",
    source: "pipeline",
    metadata: { target: WORKBENCH_PIPELINE_TARGET },
  });
  options.eventLedger.append({
    type: "pipeline.validation.started",
    summary: "Workbench validation started",
    severity: "info",
    source: "pipeline",
    metadata: { target: WORKBENCH_PIPELINE_TARGET, command },
  });

  const outcome = await (options.runsCleanFn ?? runsClean)(command, options.workDir);
  if (outcome.passed) {
    options.eventLedger.append({
      type: "pipeline.validation.passed",
      summary: "Workbench validation passed",
      severity: "info",
      source: "pipeline",
      metadata: { target: WORKBENCH_PIPELINE_TARGET, command },
    });
    options.emitReload();
    return { validated: true, passed: true, reloaded: true };
  }

  const reason = outcome.reason ?? "validation command failed";
  options.eventLedger.append({
    type: "pipeline.validation.failed",
    summary: "Workbench validation failed",
    severity: "medium",
    source: "pipeline",
    metadata: { target: WORKBENCH_PIPELINE_TARGET, command, reason },
  });

  if (options.config?.reloadOnValidationFailure === true) {
    options.emitReload();
    return { validated: true, passed: false, reloaded: true, reason };
  }

  return { validated: true, passed: false, reloaded: false, reason };
}
