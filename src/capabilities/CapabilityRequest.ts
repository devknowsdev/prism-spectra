export interface CapabilityRequest {
  capability: string;
  input: Record<string, unknown>;
  context?: Record<string, unknown>;
}
