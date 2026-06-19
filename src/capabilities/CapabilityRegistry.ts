import type { Capability } from './Capability.js';

export interface CapabilityRegistry {
  register(capability: Capability): void;
  get(id: string): Capability | undefined;
  list(): Capability[];
}
