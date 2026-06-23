import {
  type AdapterAction,
  type AdapterContract,
  type AdapterContext,
  type AdapterResult,
  createAdapterError,
  createAdapterResult,
  nowIso,
} from "./types.js";
import { blockedAdapterResult, ensureApprovalAllowed } from "./approvalGuard.js";

export function createMockGitAdapter(): AdapterContract<{ ref: string; message: string }> {
  const descriptor = {
    id: "mock-git",
    kind: "git" as const,
    mode: "mock" as const,
    approvalRequired: "required" as const,
  };

  let commitCounter = 0;
  let pushCounter = 0;

  return {
    ...descriptor,
    name: "Mock Git Adapter",
    capabilities: [
      {
        id: "status",
        label: "Status",
        kind: "git",
        description: "Read-only git status for scaffolding tests.",
        riskLevel: "read_only",
        approvalRequired: "none",
      },
      {
        id: "commit",
        label: "Commit",
        kind: "git",
        description: "Local commit simulation.",
        riskLevel: "local_write",
        approvalRequired: "recommended",
      },
      {
        id: "push",
        label: "Push",
        kind: "git",
        description: "External push simulation.",
        riskLevel: "external_write",
        approvalRequired: "required",
      },
    ],
    health: async () => ({
      status: "healthy",
      checkedAt: nowIso(),
      message: "Mock git adapter ready.",
      details: { adapterId: descriptor.id, commits: commitCounter, pushes: pushCounter },
    }),
    async execute(action: AdapterAction, context: AdapterContext): Promise<AdapterResult<{ ref: string; message: string }>> {
      try {
        ensureApprovalAllowed(descriptor, context, action);

        if (action.operation === "status") {
          return createAdapterResult(descriptor, action, {
            success: true,
            blocked: false,
            output: { ref: "status", message: "clean" },
            metadata: { source: "mock-git" },
          });
        }

        if (action.operation === "commit") {
          commitCounter += 1;
          const ref = `commit-${String(commitCounter).padStart(4, "0")}`;
          const message = String(action.input?.message ?? action.input?.summary ?? "mock commit");
          return createAdapterResult(descriptor, action, {
            success: true,
            blocked: false,
            output: { ref, message },
            metadata: { source: "mock-git", commitCounter },
          });
        }

        if (action.operation === "push") {
          pushCounter += 1;
          const ref = `push-${String(pushCounter).padStart(4, "0")}`;
          const message = String(action.input?.remote ?? "origin");
          return createAdapterResult(descriptor, action, {
            success: true,
            blocked: false,
            output: { ref, message },
            metadata: { source: "mock-git", pushCounter },
          });
        }

        return createAdapterResult<{ ref: string; message: string }>(descriptor, action, {
          success: false,
          blocked: false,
          output: null,
          error: createAdapterError(descriptor.id, action.id, "unsupported_operation", `Unsupported git operation: ${action.operation}.`),
        });
      } catch (error) {
        return blockedAdapterResult<{ ref: string; message: string }>(
          descriptor,
          action,
          createAdapterError(descriptor.id, action.id, "blocked", error instanceof Error ? error.message : String(error)),
          { source: "mock-git" },
        );
      }
    },
  };
}
