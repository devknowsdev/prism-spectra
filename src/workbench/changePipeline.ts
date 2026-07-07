import type { PrismEventLedger } from "../events/ledger.js";
import { runsClean, type ValidationOutcome } from "../safety/validation.js";

export const WORKBENCH_PIPELINE_TARGET = "workbench";

// Human-readable label for a pipeline target used in event summaries. Known
// targets get a curated label; anything else falls back to a capitalized form.
// "workbench" -> "Workbench" keeps the shipped #43 summaries byte-for-byte.
function pipelineTargetLabel(target: string): string {
  switch (target) {
    case "workbench":
      return "Workbench";
    case "focus":
      return "Focus";
    case "epk":
      return "EPK";
    default:
      return target.charAt(0).toUpperCase() + target.slice(1);
  }
}

export interface WorkbenchChangePipelineConfig {
  validate?: string;
  reloadOnValidationFailure?: boolean;
}

export interface WorkbenchChangePipelineOptions {
  /** Which watched target this change belongs to. Defaults to the Workbench. */
  target?: string;
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
  const target = options.target?.trim() || WORKBENCH_PIPELINE_TARGET;
  const label = pipelineTargetLabel(target);
  const command = options.config?.validate?.trim();
  if (!command) {
    options.emitReload();
    return { validated: false, reloaded: true };
  }

  options.eventLedger.append({
    type: "pipeline.change.detected",
    summary: `${label} change detected`,
    severity: "info",
    source: "pipeline",
    metadata: { target },
  });
  options.eventLedger.append({
    type: "pipeline.validation.started",
    summary: `${label} validation started`,
    severity: "info",
    source: "pipeline",
    metadata: { target, command },
  });

  const outcome = await (options.runsCleanFn ?? runsClean)(command, options.workDir);
  if (outcome.passed) {
    options.eventLedger.append({
      type: "pipeline.validation.passed",
      summary: `${label} validation passed`,
      severity: "info",
      source: "pipeline",
      metadata: { target, command },
    });
    options.emitReload();
    return { validated: true, passed: true, reloaded: true };
  }

  const reason = outcome.reason ?? "validation command failed";
  options.eventLedger.append({
    type: "pipeline.validation.failed",
    summary: `${label} validation failed`,
    severity: "medium",
    source: "pipeline",
    metadata: { target, command, reason },
  });

  if (options.config?.reloadOnValidationFailure === true) {
    options.emitReload();
    return { validated: true, passed: false, reloaded: true, reason };
  }

  return { validated: true, passed: false, reloaded: false, reason };
}
