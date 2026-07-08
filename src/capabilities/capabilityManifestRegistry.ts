import fs from "node:fs";
import path from "node:path";

export const capabilityStatuses = ["enabled", "disabled", "reserved"] as const;
export type CapabilityStatus = (typeof capabilityStatuses)[number];

export const capabilityKinds = [
  "model-provider",
  "local-runtime",
  "external-provider-adapter",
  "tool-action",
  "terminal-command",
  "code-assistant-action",
  "sidecar",
] as const;
export type CapabilityKind = (typeof capabilityKinds)[number];

export const capabilityRiskClasses = [
  "read-only",
  "propose-write",
  "approved-write",
  "validated-exec",
  "external",
  "destructive",
] as const;
export type CapabilityRiskClass = (typeof capabilityRiskClasses)[number];

export const capabilityLocalities = ["local", "external", "hybrid"] as const;
export type CapabilityLocality = (typeof capabilityLocalities)[number];

export const capabilityExecutionModes = [
  "read-only",
  "propose-write",
  "approved-write",
  "validated-exec",
  "external",
  "destructive",
] as const;
export type CapabilityExecutionMode = (typeof capabilityExecutionModes)[number];

const dataBoundaries = ["local", "remote_no_training", "remote_may_train"] as const;
type CapabilityDataBoundary = (typeof dataBoundaries)[number];

const networkModes = ["none", "loopback-only", "declared-hosts"] as const;
const credentialModes = ["none", "declared-env"] as const;
const costModes = ["none", "visible-before-use"] as const;
const resourceProfiles = ["tiny", "small", "medium", "heavy", "extreme"] as const;
const approvalQueueIntegrations = ["none", "required"] as const;

export interface CapabilityEntrypoint {
  type: "ai-request" | "reserved-domain" | "explicit-eval-teacher-dispatch";
  sourceApp?: string;
  intent?: string;
  domain?: string;
  adapter?: string;
}

export interface CapabilityManifestAction {
  name: string;
  apiShape: string;
  modelMayInfluenceParameters: boolean;
  terminalExecution: boolean;
  fileWritesPossible: boolean;
  allowedPathRoots: string[];
  approvalQueueIntegration: "none" | "required";
  checkpointRequired: boolean;
  validationRequired: boolean;
}

export interface CapabilityManifestModelProvider {
  roles: Array<"teacher" | "judge" | "persona-driver">;
  contextWindow: number;
  speed: "low" | "medium" | "high";
  qualityTier: "low" | "medium" | "high";
  costClass: "free" | "metered" | "paid";
  costPerToken?: {
    currency: "USD";
    inputPerMillion: number;
    outputPerMillion: number;
  };
  modalities: string[];
  provider: string;
  requiredEnvVar?: string;
  healthcheck?: {
    type: "auth-ping";
    method: "GET";
    endpoint: string;
  };
  fallbackPolicy: string;
  model: string;
}

export interface SpectraCapabilityManifest {
  id: string;
  kind: CapabilityKind;
  displayName: string;
  description: string;
  ownerRepo: "prism-spectra";
  status: CapabilityStatus;
  executionMode: CapabilityExecutionMode;
  entrypoint: CapabilityEntrypoint;
  locality: CapabilityLocality;
  dataBoundary: CapabilityDataBoundary;
  riskClass: CapabilityRiskClass;
  approvalRequired: boolean;
  allowedInputs: string[];
  allowedOutputs: string[];
  allowedPaths: string[];
  allowedEnvVars: string[];
  networkPolicy: {
    mode: (typeof networkModes)[number];
    allowedHosts: string[];
  };
  credentialPolicy: {
    mode: (typeof credentialModes)[number];
    envVars: string[];
  };
  costPolicy: {
    mode: (typeof costModes)[number];
    notes?: string;
  };
  resourcePolicy: {
    profile: (typeof resourceProfiles)[number];
    notes?: string;
  };
  provenanceFields: string[];
  telemetryFields: string[];
  validation: {
    tests: string[];
  };
  rollback: string;
  failureMode: string;
  disabledByDefault: boolean;
  verifiedOn: string;
  gatingContract?: string;
  action?: CapabilityManifestAction;
  modelProvider?: CapabilityManifestModelProvider;
}

export type CapabilityManifestTelemetry =
  | {
      status: "matched";
      id: string;
      manifestStatus: CapabilityStatus;
      kind: CapabilityKind;
      riskClass: CapabilityRiskClass;
      disabledByDefault: boolean;
    }
  | {
      status: "absent";
      sourceApp: string;
      intent: string;
    };

export interface SpectraCapabilityManifestValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: SpectraCapabilityManifest;
}

export interface CapabilityManifestLoadIssue {
  filePath: string;
  errors: string[];
}

export interface CapabilityManifestLoadResult {
  registry: SpectraCapabilityManifestRegistry;
  directory: string;
  missing: boolean;
  loaded: SpectraCapabilityManifest[];
  issues: CapabilityManifestLoadIssue[];
}

interface Logger {
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const DEFAULT_LOGGER: Logger = console;
const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_ROOT_KEYS = new Set([
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
  "modelProvider",
]);

export class SpectraCapabilityManifestRegistry {
  private readonly manifests = new Map<string, SpectraCapabilityManifest>();
  private readonly aiRequestIndex = new Map<string, SpectraCapabilityManifest>();

  constructor(manifests: readonly SpectraCapabilityManifest[] = []) {
    for (const manifest of manifests) {
      this.register(manifest);
    }
  }

  register(manifest: SpectraCapabilityManifest): void {
    const snapshot = cloneManifest(manifest);
    this.manifests.set(snapshot.id, snapshot);
    if (
      snapshot.status === "enabled" &&
      snapshot.disabledByDefault !== true &&
      snapshot.entrypoint.type === "ai-request" &&
      snapshot.entrypoint.sourceApp &&
      snapshot.entrypoint.intent
    ) {
      this.aiRequestIndex.set(aiRequestKey(snapshot.entrypoint.sourceApp, snapshot.entrypoint.intent), snapshot);
    }
  }

  list(): SpectraCapabilityManifest[] {
    return [...this.manifests.values()].map(cloneManifest);
  }

  get(id: string): SpectraCapabilityManifest | undefined {
    const manifest = this.manifests.get(id);
    return manifest ? cloneManifest(manifest) : undefined;
  }

  matchAiRequest(sourceApp: string, intent: string): CapabilityManifestTelemetry {
    const manifest = this.aiRequestIndex.get(aiRequestKey(sourceApp, intent));
    if (!manifest) {
      return { status: "absent", sourceApp, intent };
    }
    return {
      status: "matched",
      id: manifest.id,
      manifestStatus: manifest.status,
      kind: manifest.kind,
      riskClass: manifest.riskClass,
      disabledByDefault: manifest.disabledByDefault,
    };
  }
}

export function defaultCapabilityManifestDirectory(cwd = process.cwd()): string {
  return path.resolve(cwd, "capabilities");
}

export function loadCapabilityManifestRegistry(options: {
  directory?: string;
  logger?: Logger;
  warnOnMissing?: boolean;
} = {}): CapabilityManifestLoadResult {
  const directory = path.resolve(options.directory ?? defaultCapabilityManifestDirectory());
  const logger = options.logger ?? DEFAULT_LOGGER;
  const warnOnMissing = options.warnOnMissing ?? true;

  if (!fs.existsSync(directory)) {
    if (warnOnMissing) {
      logger.warn(`[capabilities] manifest directory absent; continuing without capability registry: ${directory}`);
    }
    return {
      registry: new SpectraCapabilityManifestRegistry(),
      directory,
      missing: true,
      loaded: [],
      issues: [],
    };
  }

  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) {
    const issue = { filePath: directory, errors: ["capability manifest path exists but is not a directory"] };
    logger.error(`[capabilities] ${issue.errors[0]}: ${directory}`);
    return {
      registry: new SpectraCapabilityManifestRegistry(),
      directory,
      missing: false,
      loaded: [],
      issues: [issue],
    };
  }

  const issues: CapabilityManifestLoadIssue[] = [];
  const loaded: SpectraCapabilityManifest[] = [];
  const seenIds = new Map<string, string>();
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      const issue = { filePath, errors: [`invalid JSON: ${(error as Error).message}`] };
      issues.push(issue);
      logger.error(`[capabilities] invalid ${filePath}: ${issue.errors.join("; ")}`);
      continue;
    }

    const validation = validateSpectraCapabilityManifest(parsed);
    if (validation.valid && validation.manifest) {
      const duplicate = seenIds.get(validation.manifest.id);
      if (duplicate) {
        const issue = {
          filePath,
          errors: [`duplicate capability id '${validation.manifest.id}' also declared in ${duplicate}`],
        };
        issues.push(issue);
        logger.error(`[capabilities] invalid ${filePath}: ${issue.errors.join("; ")}`);
        continue;
      }
      seenIds.set(validation.manifest.id, filePath);
      loaded.push(validation.manifest);
    } else {
      const issue = { filePath, errors: validation.errors };
      issues.push(issue);
      logger.error(`[capabilities] invalid ${filePath}: ${issue.errors.join("; ")}`);
    }
  }

  return {
    registry: new SpectraCapabilityManifestRegistry(loaded),
    directory,
    missing: false,
    loaded,
    issues,
  };
}

export function validateSpectraCapabilityManifest(value: unknown): SpectraCapabilityManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["manifest must be an object"] };
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      errors.push(`unknown field '${key}'`);
    }
  }

  const manifest = value as Partial<SpectraCapabilityManifest>;
  const id = requireString(manifest, "id", errors);
  if (id && !STABLE_ID.test(id)) errors.push("id must be stable lowercase dot/dash/underscore text");
  requireEnum(manifest, "kind", capabilityKinds, errors);
  requireString(manifest, "displayName", errors);
  requireString(manifest, "description", errors);
  requireEnum(manifest, "ownerRepo", ["prism-spectra"] as const, errors);
  const status = requireEnum(manifest, "status", capabilityStatuses, errors);
  const executionMode = requireEnum(manifest, "executionMode", capabilityExecutionModes, errors);
  requireEnum(manifest, "locality", capabilityLocalities, errors);
  requireEnum(manifest, "dataBoundary", dataBoundaries, errors);
  const riskClass = requireEnum(manifest, "riskClass", capabilityRiskClasses, errors);
  requireBoolean(manifest, "approvalRequired", errors);
  requireStringArray(manifest, "allowedInputs", errors);
  requireStringArray(manifest, "allowedOutputs", errors);
  requireStringArray(manifest, "allowedPaths", errors);
  requireEnvArray(manifest, "allowedEnvVars", errors);
  requireStringArray(manifest, "provenanceFields", errors);
  requireStringArray(manifest, "telemetryFields", errors);
  requireString(manifest, "rollback", errors);
  requireString(manifest, "failureMode", errors);
  const disabledByDefault = requireBoolean(manifest, "disabledByDefault", errors);
  const verifiedOn = requireString(manifest, "verifiedOn", errors);
  if (verifiedOn && !ISO_DATE.test(verifiedOn)) errors.push("verifiedOn must be YYYY-MM-DD");

  validateEntrypoint(manifest.entrypoint, errors);
  validateNetworkPolicy(manifest.networkPolicy, errors);
  validateCredentialPolicy(manifest.credentialPolicy, errors);
  validateCostPolicy(manifest.costPolicy, errors);
  validateResourcePolicy(manifest.resourcePolicy, errors);
  validateValidation(manifest.validation, errors);
  validateKindExtension(manifest, errors);

  if (status === "reserved") {
    if (disabledByDefault !== true) errors.push("reserved manifests must set disabledByDefault true");
    if (!stringPresent(manifest.gatingContract)) errors.push("reserved manifests must name a gatingContract");
    if (manifest.entrypoint?.type !== "reserved-domain") errors.push("reserved manifests must use entrypoint.type reserved-domain");
  }

  if (status === "enabled" && disabledByDefault === true) {
    errors.push("enabled manifests cannot be disabledByDefault");
  }

  if (riskClass !== executionMode) {
    errors.push("riskClass and executionMode must match for slice 1");
  }

  if (riskClass === "read-only") {
    if (manifest.approvalRequired !== false) errors.push("read-only manifests must not require action approval");
    if ((manifest.allowedPaths ?? []).length > 0) errors.push("read-only manifests must not declare allowedPaths");
    if ((manifest.allowedEnvVars ?? []).length > 0) errors.push("read-only manifests must not declare allowedEnvVars");
    if (manifest.credentialPolicy?.mode !== "none" || (manifest.credentialPolicy?.envVars ?? []).length > 0) {
      errors.push("read-only manifests must not declare credentials");
    }
    if (manifest.action?.terminalExecution) errors.push("read-only manifests must not declare terminal execution");
    if (manifest.action?.fileWritesPossible) errors.push("read-only manifests must not declare file writes");
    if ((manifest.action?.allowedPathRoots ?? []).length > 0) errors.push("read-only manifests must not declare action path roots");
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], manifest: cloneManifest(manifest as SpectraCapabilityManifest) };
}

function validateEntrypoint(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("entrypoint must be an object");
    return;
  }
  requireOnlyKeys(value, "entrypoint", ["type", "sourceApp", "intent", "domain", "adapter"], errors);
  const type = requireEnum(value, "type", ["ai-request", "reserved-domain", "explicit-eval-teacher-dispatch"] as const, errors, "entrypoint.type");
  if (type === "ai-request") {
    requireString(value, "sourceApp", errors, "entrypoint.sourceApp");
    requireString(value, "intent", errors, "entrypoint.intent");
    if ("domain" in value) errors.push("entrypoint.domain is only valid for reserved-domain entries");
  }
  if (type === "reserved-domain") {
    requireString(value, "domain", errors, "entrypoint.domain");
    if ("sourceApp" in value || "intent" in value) {
      errors.push("reserved-domain entrypoints must not declare sourceApp or intent");
    }
  }
  if (type === "explicit-eval-teacher-dispatch") {
    requireString(value, "adapter", errors, "entrypoint.adapter");
    if ("sourceApp" in value || "intent" in value || "domain" in value) {
      errors.push("explicit eval teacher dispatch entrypoints must not declare sourceApp, intent, or domain");
    }
  }
}

function validateNetworkPolicy(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("networkPolicy must be an object");
    return;
  }
  requireOnlyKeys(value, "networkPolicy", ["mode", "allowedHosts"], errors);
  const mode = requireEnum(value, "mode", networkModes, errors, "networkPolicy.mode");
  const hosts = requireStringArray(value, "allowedHosts", errors, "networkPolicy.allowedHosts");
  if (mode === "none" && hosts && hosts.length > 0) errors.push("networkPolicy.allowedHosts must be empty when mode is none");
  if (mode === "declared-hosts" && hosts && hosts.length === 0) errors.push("declared-hosts networkPolicy requires allowedHosts");
}

function validateCredentialPolicy(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("credentialPolicy must be an object");
    return;
  }
  requireOnlyKeys(value, "credentialPolicy", ["mode", "envVars"], errors);
  const mode = requireEnum(value, "mode", credentialModes, errors, "credentialPolicy.mode");
  const envVars = requireEnvArray(value, "envVars", errors, "credentialPolicy.envVars");
  if (mode === "none" && envVars && envVars.length > 0) errors.push("credentialPolicy.envVars must be empty when mode is none");
  if (mode === "declared-env" && envVars && envVars.length === 0) errors.push("declared-env credentialPolicy requires envVars");
}

function validateCostPolicy(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("costPolicy must be an object");
    return;
  }
  requireOnlyKeys(value, "costPolicy", ["mode", "notes"], errors);
  requireEnum(value, "mode", costModes, errors, "costPolicy.mode");
  optionalString(value, "notes", errors, "costPolicy.notes");
}

function validateResourcePolicy(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("resourcePolicy must be an object");
    return;
  }
  requireOnlyKeys(value, "resourcePolicy", ["profile", "notes"], errors);
  requireEnum(value, "profile", resourceProfiles, errors, "resourcePolicy.profile");
  optionalString(value, "notes", errors, "resourcePolicy.notes");
}

function validateValidation(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("validation must be an object");
    return;
  }
  requireOnlyKeys(value, "validation", ["tests"], errors);
  requireStringArray(value, "tests", errors, "validation.tests");
}

function validateKindExtension(manifest: Partial<SpectraCapabilityManifest>, errors: string[]): void {
  if (manifest.kind === "tool-action") {
    if (!isRecord(manifest.action)) {
      errors.push("tool-action manifests must declare action");
      return;
    }
    if ("modelProvider" in manifest) errors.push("tool-action manifests must not declare modelProvider");
    const action = manifest.action;
    requireOnlyKeys(action, "action", [
      "name",
      "apiShape",
      "modelMayInfluenceParameters",
      "terminalExecution",
      "fileWritesPossible",
      "allowedPathRoots",
      "approvalQueueIntegration",
      "checkpointRequired",
      "validationRequired",
    ], errors);
    requireString(action, "name", errors, "action.name");
    requireString(action, "apiShape", errors, "action.apiShape");
    requireBoolean(action, "modelMayInfluenceParameters", errors, "action.modelMayInfluenceParameters");
    requireBoolean(action, "terminalExecution", errors, "action.terminalExecution");
    requireBoolean(action, "fileWritesPossible", errors, "action.fileWritesPossible");
    requireStringArray(action, "allowedPathRoots", errors, "action.allowedPathRoots");
    requireEnum(action, "approvalQueueIntegration", approvalQueueIntegrations, errors, "action.approvalQueueIntegration");
    requireBoolean(action, "checkpointRequired", errors, "action.checkpointRequired");
    requireBoolean(action, "validationRequired", errors, "action.validationRequired");
    return;
  }

  if (manifest.kind === "model-provider") {
    if (!isRecord(manifest.modelProvider)) {
      errors.push("model-provider manifests must declare modelProvider");
      return;
    }
    if ("action" in manifest) errors.push("model-provider manifests must not declare action");
    const modelProvider = manifest.modelProvider;
    requireOnlyKeys(modelProvider, "modelProvider", [
      "roles",
      "contextWindow",
      "speed",
      "qualityTier",
      "costClass",
      "costPerToken",
      "modalities",
      "provider",
      "requiredEnvVar",
      "healthcheck",
      "fallbackPolicy",
      "model",
    ], errors);
    const roles = requireStringArray(modelProvider, "roles", errors, "modelProvider.roles");
    if (roles) {
      for (const role of roles) {
        if (!["teacher", "judge", "persona-driver"].includes(role)) {
          errors.push("modelProvider.roles entries must be one of: teacher, judge, persona-driver");
        }
      }
    }
    requirePositiveInteger(modelProvider, "contextWindow", errors, "modelProvider.contextWindow");
    requireEnum(modelProvider, "speed", ["low", "medium", "high"] as const, errors, "modelProvider.speed");
    requireEnum(modelProvider, "qualityTier", ["low", "medium", "high"] as const, errors, "modelProvider.qualityTier");
    requireEnum(modelProvider, "costClass", ["free", "metered", "paid"] as const, errors, "modelProvider.costClass");
    validateCostPerToken(modelProvider.costPerToken, errors);
    requireStringArray(modelProvider, "modalities", errors, "modelProvider.modalities");
    requireString(modelProvider, "provider", errors, "modelProvider.provider");
    optionalEnvVar(modelProvider, "requiredEnvVar", errors, "modelProvider.requiredEnvVar");
    validateModelProviderHealthcheck(modelProvider.healthcheck, errors);
    const fallbackPolicy = requireString(modelProvider, "fallbackPolicy", errors, "modelProvider.fallbackPolicy");
    if (fallbackPolicy && fallbackPolicy !== "never-normal-routing") {
      errors.push("modelProvider.fallbackPolicy must be never-normal-routing");
    }
    requireString(modelProvider, "model", errors, "modelProvider.model");
    const requiredEnvVar = typeof modelProvider.requiredEnvVar === "string" ? modelProvider.requiredEnvVar : undefined;
    if (requiredEnvVar) {
      if (!(manifest.allowedEnvVars ?? []).includes(requiredEnvVar)) {
        errors.push("modelProvider.requiredEnvVar must be listed in allowedEnvVars");
      }
      if (!(manifest.credentialPolicy?.envVars ?? []).includes(requiredEnvVar)) {
        errors.push("modelProvider.requiredEnvVar must be listed in credentialPolicy.envVars");
      }
    }
    if (manifest.entrypoint?.type !== "explicit-eval-teacher-dispatch") {
      errors.push("model-provider manifests must use explicit-eval-teacher-dispatch entrypoints");
    }
    return;
  }

  if ("action" in manifest) errors.push(`${manifest.kind ?? "unknown"} manifests must not declare action`);
  if ("modelProvider" in manifest) errors.push(`${manifest.kind ?? "unknown"} manifests must not declare modelProvider`);
}

function aiRequestKey(sourceApp: string, intent: string): string {
  return `${sourceApp.trim()}\0${intent.trim()}`;
}

function cloneManifest(manifest: SpectraCapabilityManifest): SpectraCapabilityManifest {
  return structuredClone(manifest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringPresent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireOnlyKeys(value: Record<string, unknown>, prefix: string, allowed: readonly string[], errors: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`unknown field '${prefix}.${key}'`);
  }
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  errors: string[],
  label = key
): string | undefined {
  const raw = value[key];
  if (!stringPresent(raw)) {
    errors.push(`${label} must be a non-empty string`);
    return undefined;
  }
  return raw.trim();
}

function optionalString(value: Record<string, unknown>, key: string, errors: string[], label = key): void {
  if (!(key in value) || value[key] == null) return;
  if (typeof value[key] !== "string") errors.push(`${label} must be a string when provided`);
}

function requireBoolean(
  value: Record<string, unknown>,
  key: string,
  errors: string[],
  label = key
): boolean | undefined {
  if (typeof value[key] !== "boolean") {
    errors.push(`${label} must be a boolean`);
    return undefined;
  }
  return value[key] as boolean;
}

function requireEnum<T extends string>(
  value: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  errors: string[],
  label = key
): T | undefined {
  const raw = value[key];
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    errors.push(`${label} must be one of: ${allowed.join(", ")}`);
    return undefined;
  }
  return raw as T;
}

function requireStringArray(
  value: Record<string, unknown>,
  key: string,
  errors: string[],
  label = key
): string[] | undefined {
  const raw = value[key];
  if (!Array.isArray(raw) || raw.some((item) => !stringPresent(item))) {
    errors.push(`${label} must be an array of non-empty strings`);
    return undefined;
  }
  if (new Set(raw).size !== raw.length) errors.push(`${label} must not contain duplicate values`);
  return raw as string[];
}

function requireEnvArray(
  value: Record<string, unknown>,
  key: string,
  errors: string[],
  label = key
): string[] | undefined {
  const raw = requireStringArray(value, key, errors, label);
  if (!raw) return undefined;
  for (const item of raw) {
    if (!ENV_VAR_NAME.test(item)) {
      errors.push(`${label} entries must be environment variable names, not values`);
    }
  }
  return raw;
}

function optionalEnvVar(value: Record<string, unknown>, key: string, errors: string[], label = key): void {
  if (!(key in value) || value[key] == null) return;
  if (typeof value[key] !== "string" || !ENV_VAR_NAME.test(value[key])) {
    errors.push(`${label} must be an environment variable name`);
  }
}

function requirePositiveInteger(value: Record<string, unknown>, key: string, errors: string[], label = key): void {
  const raw = value[key];
  if (!Number.isInteger(raw) || Number(raw) < 1) errors.push(`${label} must be a positive integer`);
}

function optionalNonNegativeNumber(value: Record<string, unknown>, key: string, errors: string[], label = key): void {
  if (!(key in value) || value[key] == null) return;
  if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0) {
    errors.push(`${label} must be a non-negative number`);
  }
}

function validateCostPerToken(value: unknown, errors: string[]): void {
  if (value == null) return;
  if (!isRecord(value)) {
    errors.push("modelProvider.costPerToken must be an object when provided");
    return;
  }
  requireOnlyKeys(value, "modelProvider.costPerToken", ["currency", "inputPerMillion", "outputPerMillion"], errors);
  requireEnum(value, "currency", ["USD"] as const, errors, "modelProvider.costPerToken.currency");
  requireNonNegativeNumber(value, "inputPerMillion", errors, "modelProvider.costPerToken.inputPerMillion");
  requireNonNegativeNumber(value, "outputPerMillion", errors, "modelProvider.costPerToken.outputPerMillion");
}

function validateModelProviderHealthcheck(value: unknown, errors: string[]): void {
  if (value == null) return;
  if (!isRecord(value)) {
    errors.push("modelProvider.healthcheck must be an object when provided");
    return;
  }
  requireOnlyKeys(value, "modelProvider.healthcheck", ["type", "method", "endpoint"], errors);
  requireEnum(value, "type", ["auth-ping"] as const, errors, "modelProvider.healthcheck.type");
  requireEnum(value, "method", ["GET"] as const, errors, "modelProvider.healthcheck.method");
  const endpoint = requireString(value, "endpoint", errors, "modelProvider.healthcheck.endpoint");
  if (endpoint) {
    try {
      new URL(endpoint);
    } catch {
      errors.push("modelProvider.healthcheck.endpoint must be a URL");
    }
  }
}

function requireNonNegativeNumber(value: Record<string, unknown>, key: string, errors: string[], label = key): void {
  const raw = value[key];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    errors.push(`${label} must be a non-negative number`);
  }
}
