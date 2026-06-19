export interface Capability {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  canHandle(request: import('./CapabilityRequest.js').CapabilityRequest): boolean;
  execute(request: import('./CapabilityRequest.js').CapabilityRequest): Promise<import('./CapabilityResult.js').CapabilityResult>;
}
