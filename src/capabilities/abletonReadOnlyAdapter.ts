export const ABLETON_READ_ONLY_ADAPTER_ID = "ableton-read-only-bridge-v1" as const;
export const ABLETON_READ_ONLY_PROTOCOL = "correlated-read-only-v1" as const;
export const ABLETON_READ_ONLY_GATE_CONTRACT =
  "prism-beam/docs/contracts/ABLETON_READ_ONLY_CAPABILITY_CONTRACT_2026-07-16.md" as const;

export const abletonReadOnlyCapabilityIds = [
  "ableton.live.get_version",
  "ableton.live.inspect_selected_track",
  "ableton.live.inspect_device",
  "ableton.live.list_device_parameters",
] as const;

export type AbletonReadOnlyCapabilityId = (typeof abletonReadOnlyCapabilityIds)[number];

const CAPABILITY_DEFINITIONS: Record<
  AbletonReadOnlyCapabilityId,
  { tool: string; intent: string; pathRequired: boolean }
> = {
  "ableton.live.get_version": {
    tool: "get_live_version",
    intent: "get-live-version",
    pathRequired: false,
  },
  "ableton.live.inspect_selected_track": {
    tool: "inspect_selected_track",
    intent: "inspect-selected-track",
    pathRequired: false,
  },
  "ableton.live.inspect_device": {
    tool: "inspect_device_at_path",
    intent: "inspect-device",
    pathRequired: true,
  },
  "ableton.live.list_device_parameters": {
    tool: "list_device_parameters",
    intent: "list-device-parameters",
    pathRequired: true,
  },
};

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEVICE_PATH = /^live_set tracks (0|[1-9][0-9]*) devices (0|[1-9][0-9]*)$/;
const MANIFEST_ROOT_KEYS = new Set([
  "id",
  "kind",
  "displayName",
  "description",
  "ownerRepo",
  "status",
  "executionMode",
  "entrypoint",
  "locality",
  "dataBoundary",
  "riskClass",
  "approvalRequired",
  "allowedInputs",
  "allowedOutputs",
  "allowedPaths",
  "allowedEnvVars",
  "networkPolicy",
  "credentialPolicy",
  "costPolicy",
  "resourcePolicy",
  "provenanceFields",
  "telemetryFields",
  "validation",
  "rollback",
  "failureMode",
  "disabledByDefault",
  "verifiedOn",
  "gatingContract",
  "action",
]);

export interface StagedAbletonReadOnlyManifest {
  id: AbletonReadOnlyCapabilityId;
  kind: "tool-action";
  displayName: string;
  description: string;
  ownerRepo: "prism-spectra";
  status: "disabled";
  executionMode: "read-only";
  entrypoint: {
    type: "tool-request";
    sourceApp: "ableton-copilot";
    intent: string;
    adapter: typeof ABLETON_READ_ONLY_ADAPTER_ID;
  };
  locality: "local";
  dataBoundary: "local";
  riskClass: "read-only";
  approvalRequired: false;
  allowedInputs: string[];
  allowedOutputs: string[];
  allowedPaths: [];
  allowedEnvVars: [];
  networkPolicy: { mode: "none"; allowedHosts: [] };
  credentialPolicy: { mode: "none"; envVars: [] };
  costPolicy: { mode: "none"; notes?: string };
  resourcePolicy: { profile: "tiny"; notes?: string };
  provenanceFields: string[];
  telemetryFields: string[];
  validation: { tests: string[] };
  rollback: string;
  failureMode: string;
  disabledByDefault: true;
  verifiedOn: string;
  gatingContract: typeof ABLETON_READ_ONLY_GATE_CONTRACT;
  action: {
    name: string;
    apiShape: string;
    modelMayInfluenceParameters: false;
    terminalExecution: false;
    fileWritesPossible: false;
    allowedPathRoots: [];
    approvalQueueIntegration: "none";
    checkpointRequired: false;
    validationRequired: true;
  };
}

export interface AbletonReadOnlyRequest {
  capabilityId: AbletonReadOnlyCapabilityId;
  requestId: string;
  path?: string;
}

export interface AbletonReadOnlyRequestPlan {
  adapter: typeof ABLETON_READ_ONLY_ADAPTER_ID;
  protocol: typeof ABLETON_READ_ONLY_PROTOCOL;
  capabilityId: AbletonReadOnlyCapabilityId;
  requestId: string;
  tool: string;
  path?: string;
  manifestStatus: "disabled";
  executable: false;
  reason: "runtime_gate_not_approved";
}

export type AbletonManifestValidationResult =
  | { valid: true; errors: []; manifest: StagedAbletonReadOnlyManifest }
  | { valid: false; errors: string[] };

export type AbletonManifestSetValidationResult =
  | { valid: true; errors: []; manifests: StagedAbletonReadOnlyManifest[] }
  | { valid: false; errors: string[] };

export type AbletonRequestPlanResult =
  | { ok: true; plan: AbletonReadOnlyRequestPlan }
  | {
      ok: false;
      error:
        | "invalid_request"
        | "invalid_request_id"
        | "unknown_capability"
        | "manifest_missing"
        | "manifest_invalid"
        | "missing_path"
        | "unexpected_path"
        | "invalid_path";
    };

export type AbletonExecutionResult = {
  ok: false;
  error: "adapter_disabled";
  reason: "runtime_gate_not_approved";
};

export function validateAbletonReadOnlyManifest(value: unknown): AbletonManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["manifest must be an object"] };

  for (const key of Object.keys(value)) {
    if (!MANIFEST_ROOT_KEYS.has(key)) errors.push(`unknown field '${key}'`);
  }

  const id = typeof value.id === "string" ? value.id : "";
  if (!isCapabilityId(id)) errors.push("id must be one approved Ableton read-only capability ID");
  const definition = isCapabilityId(id) ? CAPABILITY_DEFINITIONS[id] : undefined;

  requireEqual(value, "kind", "tool-action", errors);
  requireNonEmptyString(value, "displayName", errors);
  requireNonEmptyString(value, "description", errors);
  requireEqual(value, "ownerRepo", "prism-spectra", errors);
  requireEqual(value, "status", "disabled", errors);
  requireEqual(value, "executionMode", "read-only", errors);
  requireEqual(value, "locality", "local", errors);
  requireEqual(value, "dataBoundary", "local", errors);
  requireEqual(value, "riskClass", "read-only", errors);
  requireEqual(value, "approvalRequired", false, errors);
  requireStringArray(value, "allowedInputs", errors);
  requireStringArray(value, "allowedOutputs", errors);
  requireEmptyArray(value, "allowedPaths", errors);
  requireEmptyArray(value, "allowedEnvVars", errors);
  requireStringArray(value, "provenanceFields", errors);
  requireStringArray(value, "telemetryFields", errors);
  requireNonEmptyString(value, "rollback", errors);
  requireNonEmptyString(value, "failureMode", errors);
  requireEqual(value, "disabledByDefault", true, errors);
  requireIsoDate(value, "verifiedOn", errors);
  requireEqual(value, "gatingContract", ABLETON_READ_ONLY_GATE_CONTRACT, errors);

  validateEntrypoint(value.entrypoint, definition, errors);
  validateNetworkPolicy(value.networkPolicy, errors);
  validateCredentialPolicy(value.credentialPolicy, errors);
  validateCostPolicy(value.costPolicy, errors);
  validateResourcePolicy(value.resourcePolicy, errors);
  validateValidation(value.validation, errors);
  validateAction(value.action, definition, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], manifest: structuredClone(value) as StagedAbletonReadOnlyManifest };
}

export function validateAbletonReadOnlyManifestSet(values: readonly unknown[]): AbletonManifestSetValidationResult {
  const errors: string[] = [];
  const manifests: StagedAbletonReadOnlyManifest[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < values.length; index += 1) {
    const validation = validateAbletonReadOnlyManifest(values[index]);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => `manifest[${index}]: ${error}`));
      continue;
    }
    if (seen.has(validation.manifest.id)) {
      errors.push(`duplicate capability id '${validation.manifest.id}'`);
      continue;
    }
    seen.add(validation.manifest.id);
    manifests.push(validation.manifest);
  }

  for (const id of abletonReadOnlyCapabilityIds) {
    if (!seen.has(id)) errors.push(`missing capability '${id}'`);
  }
  for (const id of seen) {
    if (!isCapabilityId(id)) errors.push(`unexpected capability '${id}'`);
  }
  if (values.length !== abletonReadOnlyCapabilityIds.length) {
    errors.push(`manifest set must contain exactly ${abletonReadOnlyCapabilityIds.length} entries`);
  }

  if (errors.length > 0) return { valid: false, errors };
  manifests.sort((a, b) => a.id.localeCompare(b.id));
  return { valid: true, errors: [], manifests };
}

export function planAbletonReadOnlyRequest(
  manifests: readonly StagedAbletonReadOnlyManifest[],
  value: unknown,
): AbletonRequestPlanResult {
  if (!isRecord(value)) return { ok: false, error: "invalid_request" };

  const capabilityId = value.capabilityId;
  const requestId = value.requestId;
  const path = value.path;

  if (typeof capabilityId !== "string" || !isCapabilityId(capabilityId)) {
    return { ok: false, error: "unknown_capability" };
  }
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
    return { ok: false, error: "invalid_request_id" };
  }

  const manifest = manifests.find((candidate) => candidate.id === capabilityId);
  if (!manifest) return { ok: false, error: "manifest_missing" };
  const manifestValidation = validateAbletonReadOnlyManifest(manifest);
  if (!manifestValidation.valid) return { ok: false, error: "manifest_invalid" };

  const definition = CAPABILITY_DEFINITIONS[capabilityId];
  if (definition.pathRequired) {
    if (typeof path !== "string" || path.length === 0) return { ok: false, error: "missing_path" };
    if (!DEVICE_PATH.test(path)) return { ok: false, error: "invalid_path" };
  } else if (path !== undefined) {
    return { ok: false, error: "unexpected_path" };
  }

  return {
    ok: true,
    plan: {
      adapter: ABLETON_READ_ONLY_ADAPTER_ID,
      protocol: ABLETON_READ_ONLY_PROTOCOL,
      capabilityId,
      requestId,
      tool: definition.tool,
      ...(typeof path === "string" ? { path } : {}),
      manifestStatus: "disabled",
      executable: false,
      reason: "runtime_gate_not_approved",
    },
  };
}

export function executeAbletonReadOnlyRequest(): AbletonExecutionResult {
  return {
    ok: false,
    error: "adapter_disabled",
    reason: "runtime_gate_not_approved",
  };
}

export function isCanonicalAbletonDevicePath(value: string): boolean {
  return DEVICE_PATH.test(value);
}

function isCapabilityId(value: string): value is AbletonReadOnlyCapabilityId {
  return (abletonReadOnlyCapabilityIds as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireEqual(
  value: Record<string, unknown>,
  key: string,
  expected: string | boolean,
  errors: string[],
): void {
  if (value[key] !== expected) errors.push(`${key} must equal ${JSON.stringify(expected)}`);
}

function requireNonEmptyString(value: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof value[key] !== "string" || value[key].trim().length === 0) {
    errors.push(`${key} must be a non-empty string`);
  }
}

function requireIsoDate(value: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof value[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value[key])) {
    errors.push(`${key} must be YYYY-MM-DD`);
  }
}

function requireStringArray(value: Record<string, unknown>, key: string, errors: string[]): void {
  const raw = value[key];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    errors.push(`${key} must be an array of non-empty strings`);
    return;
  }
  if (new Set(raw).size !== raw.length) errors.push(`${key} must not contain duplicates`);
}

function requireEmptyArray(value: Record<string, unknown>, key: string, errors: string[]): void {
  if (!Array.isArray(value[key]) || value[key].length !== 0) errors.push(`${key} must be an empty array`);
}

function validateEntrypoint(
  value: unknown,
  definition: { tool: string; intent: string; pathRequired: boolean } | undefined,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push("entrypoint must be an object");
    return;
  }
  requireExactKeys(value, "entrypoint", ["type", "sourceApp", "intent", "adapter"], errors);
  requireEqual(value, "type", "tool-request", errors);
  requireEqual(value, "sourceApp", "ableton-copilot", errors);
  requireEqual(value, "adapter", ABLETON_READ_ONLY_ADAPTER_ID, errors);
  if (definition && value.intent !== definition.intent) errors.push(`entrypoint.intent must equal ${definition.intent}`);
}

function validateNetworkPolicy(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("networkPolicy must be an object");
    return;
  }
  requireExactKeys(value, "networkPolicy", ["mode", "allowedHosts"], errors);
  requireEqual(value, "mode", "none", errors);
  requireEmptyArray(value, "allowedHosts", errors);
}

function validateCredentialPolicy(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("credentialPolicy must be an object");
    return;
  }
  requireExactKeys(value, "credentialPolicy", ["mode", "envVars"], errors);
  requireEqual(value, "mode", "none", errors);
  requireEmptyArray(value, "envVars", errors);
}

function validateCostPolicy(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("costPolicy must be an object");
    return;
  }
  requireAllowedKeys(value, "costPolicy", ["mode", "notes"], errors);
  requireEqual(value, "mode", "none", errors);
  if ("notes" in value && typeof value.notes !== "string") errors.push("costPolicy.notes must be a string");
}

function validateResourcePolicy(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("resourcePolicy must be an object");
    return;
  }
  requireAllowedKeys(value, "resourcePolicy", ["profile", "notes"], errors);
  requireEqual(value, "profile", "tiny", errors);
  if ("notes" in value && typeof value.notes !== "string") errors.push("resourcePolicy.notes must be a string");
}

function validateValidation(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("validation must be an object");
    return;
  }
  requireExactKeys(value, "validation", ["tests"], errors);
  requireStringArray(value, "tests", errors);
}

function validateAction(
  value: unknown,
  definition: { tool: string; intent: string; pathRequired: boolean } | undefined,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push("action must be an object");
    return;
  }
  requireExactKeys(
    value,
    "action",
    [
      "name",
      "apiShape",
      "modelMayInfluenceParameters",
      "terminalExecution",
      "fileWritesPossible",
      "allowedPathRoots",
      "approvalQueueIntegration",
      "checkpointRequired",
      "validationRequired",
    ],
    errors,
  );
  if (definition && value.name !== definition.tool) errors.push(`action.name must equal ${definition.tool}`);
  requireNonEmptyString(value, "apiShape", errors);
  requireEqual(value, "modelMayInfluenceParameters", false, errors);
  requireEqual(value, "terminalExecution", false, errors);
  requireEqual(value, "fileWritesPossible", false, errors);
  requireEmptyArray(value, "allowedPathRoots", errors);
  requireEqual(value, "approvalQueueIntegration", "none", errors);
  requireEqual(value, "checkpointRequired", false, errors);
  requireEqual(value, "validationRequired", true, errors);
}

function requireExactKeys(
  value: Record<string, unknown>,
  prefix: string,
  expected: readonly string[],
  errors: string[],
): void {
  requireAllowedKeys(value, prefix, expected, errors);
  for (const key of expected) {
    if (!(key in value)) errors.push(`${prefix}.${key} is required`);
  }
}

function requireAllowedKeys(
  value: Record<string, unknown>,
  prefix: string,
  allowed: readonly string[],
  errors: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`unknown field '${prefix}.${key}'`);
  }
}
