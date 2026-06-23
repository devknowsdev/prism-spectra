import {
  type AdapterContract,
  type AdapterHealth,
  type AdapterKind,
  nowIso,
} from "./types.js";
import { validateAdapterContract } from "./approvalGuard.js";

export interface AdapterRegistry {
  registerAdapter: (adapter: AdapterContract) => AdapterContract;
  getAdapter: (adapterId: string) => AdapterContract | undefined;
  listAdapters: () => AdapterContract[];
  listAdaptersByKind: (kind: AdapterKind) => AdapterContract[];
  checkAdapterHealth: (adapterId: string) => Promise<AdapterHealth>;
}

export function createAdapterRegistry(): AdapterRegistry {
  const adapters = new Map<string, AdapterContract>();

  return {
    registerAdapter(adapter: AdapterContract): AdapterContract {
      validateAdapterContract(adapter);
      adapters.set(adapter.id, adapter);
      return adapter;
    },

    getAdapter(adapterId: string): AdapterContract | undefined {
      return adapters.get(adapterId);
    },

    listAdapters(): AdapterContract[] {
      return [...adapters.values()];
    },

    listAdaptersByKind(kind: AdapterKind): AdapterContract[] {
      return [...adapters.values()].filter((adapter) => adapter.kind === kind);
    },

    async checkAdapterHealth(adapterId: string): Promise<AdapterHealth> {
      const adapter = adapters.get(adapterId);
      if (!adapter) {
        return {
          status: "unhealthy",
          checkedAt: nowIso(),
          message: `Adapter ${adapterId} is not registered.`,
          details: { adapterId },
        };
      }

      if (!adapter.health) {
        return {
          status: "healthy",
          checkedAt: nowIso(),
          message: `Adapter ${adapterId} exposes no health hook; assumed healthy.`,
          details: { adapterId, kind: adapter.kind, mode: adapter.mode },
        };
      }

      try {
        return await adapter.health();
      } catch (error) {
        return {
          status: "unhealthy",
          checkedAt: nowIso(),
          message: error instanceof Error ? error.message : String(error),
          details: { adapterId, error: String(error) },
        };
      }
    },
  };
}

const defaultRegistry = createAdapterRegistry();

export const registerAdapter = defaultRegistry.registerAdapter;
export const getAdapter = defaultRegistry.getAdapter;
export const listAdapters = defaultRegistry.listAdapters;
export const listAdaptersByKind = defaultRegistry.listAdaptersByKind;
export const checkAdapterHealth = defaultRegistry.checkAdapterHealth;

