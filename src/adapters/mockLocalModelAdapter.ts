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

export function createMockLocalModelAdapter(): AdapterContract<{ text: string; echo: string }> {
  const descriptor = {
    id: "mock-local-model",
    kind: "local_model" as const,
    mode: "mock" as const,
    approvalRequired: "none" as const,
  };

  return {
    ...descriptor,
    name: "Mock Local Model Adapter",
    capabilities: [
      {
        id: "generate",
        label: "Generate",
        kind: "local_model",
        description: "Deterministic local prompt echo for scaffolding tests.",
        riskLevel: "read_only",
        approvalRequired: "none",
      },
    ],
    health: async () => ({
      status: "healthy",
      checkedAt: nowIso(),
      message: "Mock local model ready.",
      details: { adapterId: descriptor.id },
    }),
    async execute(action: AdapterAction, context: AdapterContext): Promise<AdapterResult<{ text: string; echo: string }>> {
      try {
        ensureApprovalAllowed(descriptor, context, action);
        const prompt = String(action.input?.prompt ?? action.input?.text ?? "");
        const text = `mock-local-model:${action.operation}:${prompt}`;
        return createAdapterResult(descriptor, action, {
          success: true,
          blocked: false,
          output: { text, echo: prompt },
          metadata: { source: "mock-local-model" },
        });
      } catch (error) {
        return blockedAdapterResult<{ text: string; echo: string }>(
          descriptor,
          action,
          createAdapterError(descriptor.id, action.id, "blocked", error instanceof Error ? error.message : String(error)),
        );
      }
    },
  };
}
