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

export function createMockFilesystemAdapter(initialFiles: Record<string, string> = {}): AdapterContract<{ path: string; content?: string; written?: boolean }> {
  const store = new Map<string, string>(Object.entries(initialFiles));
  const descriptor = {
    id: "mock-filesystem",
    kind: "filesystem" as const,
    mode: "mock" as const,
    approvalRequired: "recommended" as const,
  };

  return {
    ...descriptor,
    name: "Mock Filesystem Adapter",
    capabilities: [
      {
        id: "read",
        label: "Read file",
        kind: "filesystem",
        description: "Read from a deterministic in-memory file map.",
        riskLevel: "read_only",
        approvalRequired: "none",
      },
      {
        id: "write",
        label: "Write file",
        kind: "filesystem",
        description: "Write to the in-memory file map for local-only scaffolding tests.",
        riskLevel: "local_write",
        approvalRequired: "recommended",
      },
    ],
    health: async () => ({
      status: "healthy",
      checkedAt: nowIso(),
      message: "Mock filesystem ready.",
      details: { adapterId: descriptor.id, fileCount: store.size },
    }),
    async execute(action: AdapterAction, context: AdapterContext): Promise<AdapterResult<{ path: string; content?: string; written?: boolean }>> {
      try {
        ensureApprovalAllowed(descriptor, context, action);
        const path = String(action.input?.path ?? "");
        if (!path) {
          return createAdapterResult<{ path: string; content?: string; written?: boolean }>(descriptor, action, {
            success: false,
            blocked: false,
            output: null,
            error: createAdapterError(descriptor.id, action.id, "missing_path", "Filesystem actions require input.path."),
          });
        }

        if (action.operation === "read") {
          const content = store.get(path) ?? "";
          return createAdapterResult(descriptor, action, {
            success: true,
            blocked: false,
            output: { path, content },
            metadata: { source: "mock-filesystem", fileCount: store.size },
          });
        }

        if (action.operation === "write") {
          const content = String(action.input?.content ?? "");
          store.set(path, content);
          return createAdapterResult(descriptor, action, {
            success: true,
            blocked: false,
            output: { path, content, written: true },
            metadata: { source: "mock-filesystem", fileCount: store.size },
          });
        }

        return createAdapterResult<{ path: string; content?: string; written?: boolean }>(descriptor, action, {
          success: false,
          blocked: false,
          output: null,
          error: createAdapterError(descriptor.id, action.id, "unsupported_operation", `Unsupported filesystem operation: ${action.operation}.`),
        });
      } catch (error) {
        return blockedAdapterResult<{ path: string; content?: string; written?: boolean }>(
          descriptor,
          action,
          createAdapterError(descriptor.id, action.id, "blocked", error instanceof Error ? error.message : String(error)),
          { source: "mock-filesystem" },
        );
      }
    },
  };
}
