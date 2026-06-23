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

export function createMockExternalPublishingAdapter(): AdapterContract<{ id: string; status: string; channel: string }> {
  const descriptor = {
    id: "mock-external-publishing",
    kind: "social_publishing" as const,
    mode: "mock" as const,
    approvalRequired: "required" as const,
  };

  let draftCounter = 0;
  let publishCounter = 0;

  return {
    ...descriptor,
    name: "Mock External Publishing Adapter",
    capabilities: [
      {
        id: "draft",
        label: "Draft publication",
        kind: "social_publishing",
        description: "Create a draft without publishing externally.",
        riskLevel: "external_draft",
        approvalRequired: "recommended",
      },
      {
        id: "publish",
        label: "Publish",
        kind: "social_publishing",
        description: "Publish externally when approval is explicitly present.",
        riskLevel: "external_write",
        approvalRequired: "required",
      },
    ],
    health: async () => ({
      status: "healthy",
      checkedAt: nowIso(),
      message: "Mock external publishing adapter ready.",
      details: { adapterId: descriptor.id, drafts: draftCounter, publishes: publishCounter },
    }),
    async execute(action: AdapterAction, context: AdapterContext): Promise<AdapterResult<{ id: string; status: string; channel: string }>> {
      try {
        ensureApprovalAllowed(descriptor, context, action);

        if (action.operation === "draft") {
          draftCounter += 1;
          const id = `draft-${String(draftCounter).padStart(4, "0")}`;
          const channel = String(action.input?.channel ?? "social");
          return createAdapterResult(descriptor, action, {
            success: true,
            blocked: false,
            output: { id, status: "draft", channel },
            metadata: { source: "mock-external-publishing", draftCounter },
          });
        }

        if (action.operation === "publish") {
          publishCounter += 1;
          const id = `publish-${String(publishCounter).padStart(4, "0")}`;
          const channel = String(action.input?.channel ?? "social");
          return createAdapterResult(descriptor, action, {
            success: true,
            blocked: false,
            output: { id, status: "published", channel },
            metadata: { source: "mock-external-publishing", publishCounter, approved: true },
          });
        }

        return createAdapterResult<{ id: string; status: string; channel: string }>(descriptor, action, {
          success: false,
          blocked: false,
          output: null,
          error: createAdapterError(descriptor.id, action.id, "unsupported_operation", `Unsupported publishing operation: ${action.operation}.`),
        });
      } catch (error) {
        return blockedAdapterResult<{ id: string; status: string; channel: string }>(
          descriptor,
          action,
          createAdapterError(descriptor.id, action.id, "blocked", error instanceof Error ? error.message : String(error)),
          { source: "mock-external-publishing" },
        );
      }
    },
  };
}
