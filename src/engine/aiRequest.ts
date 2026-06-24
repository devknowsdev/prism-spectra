import type { ChainAttempt } from "../routing/router.js";
import type { DataBoundary, ExecutorName, NodeType } from "../types.js";

export const AI_REQUEST_RISK_CLASSES = ["read-only"] as const;
export type AiRequestRiskClass = (typeof AI_REQUEST_RISK_CLASSES)[number];

export interface AiRequestInput {
  sourceApp: string;
  intent: string;
  riskClass?: AiRequestRiskClass;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  preferredMode?: "local-first" | "local-only" | "balanced";
  nodeType?: Exclude<NodeType, "terminal">;
  conversationId?: number | string | null;
  record?: boolean;
}

export interface AiRequestSuccess {
  ok: true;
  provider: ExecutorName;
  model: string | null;
  dataBoundary: DataBoundary;
  response: string;
  structuredResponse: unknown | null;
  provenance: {
    routedBy: "prism-spectra";
    sourceApp: string;
    riskClass: AiRequestRiskClass;
    preferredMode: AiRequestInput["preferredMode"];
    graphId: string;
    nodeId: string;
    recorded: boolean;
    chainTried: ChainAttempt[];
  };
  usage: {
    tokensIn: number;
    tokensOut: number;
    cost: number;
    latencyMs: number;
  };
}

export interface AiRequestFailure {
  ok: false;
  provider: ExecutorName | null;
  model: string | null;
  dataBoundary?: DataBoundary;
  response: string;
  error: string;
  provenance: {
    routedBy: "prism-spectra";
    sourceApp: string;
    riskClass: AiRequestRiskClass;
    preferredMode: AiRequestInput["preferredMode"];
    graphId: string;
    nodeId: string;
    recorded: boolean;
    chainTried: ChainAttempt[];
  };
  usage?: {
    tokensIn: number;
    tokensOut: number;
    cost: number;
    latencyMs: number;
  };
}

export type AiRequestResult = AiRequestSuccess | AiRequestFailure;

export type AiRequestValidation =
  | { ok: true; request: AiRequestInput }
  | { ok: false; error: string };

export function normalizeAiRequestBody(body: unknown): AiRequestValidation {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "expected JSON body" };
  }

  const raw = body as Record<string, unknown>;
  const sourceApp = normalizeString(raw.sourceApp, "sourceApp");
  const intent = normalizeString(raw.intent, "intent");
  if (!sourceApp.ok) return sourceApp;
  if (!intent.ok) return intent;

  const riskClass = raw.riskClass == null ? "read-only" : String(raw.riskClass);
  if (riskClass !== "read-only") {
    return { ok: false, error: "ai request endpoint only accepts riskClass=read-only" };
  }

  const nodeType = raw.nodeType == null ? undefined : String(raw.nodeType);
  if (nodeType === "terminal") {
    return { ok: false, error: "ai request endpoint does not accept terminal nodeType" };
  }
  if (nodeType != null && !["ui", "backend", "tests", "docs"].includes(nodeType)) {
    return { ok: false, error: "nodeType must be one of ui, backend, tests, docs" };
  }

  const input = optionalRecord(raw.input, "input");
  if (!input.ok) return input;
  const context = optionalRecord(raw.context, "context");
  if (!context.ok) return context;

  return {
    ok: true,
    request: {
      sourceApp: sourceApp.value,
      intent: intent.value,
      riskClass: "read-only",
      input: input.value,
      context: context.value,
      preferredMode: normalizePreferredMode(raw.preferredMode),
      nodeType: (nodeType as AiRequestInput["nodeType"]) ?? "docs",
      conversationId: raw.conversationId as AiRequestInput["conversationId"],
      record: raw.record === false ? false : true,
    },
  };
}

export function buildAiRequestIntent(request: AiRequestInput): string {
  const payload = {
    sourceApp: request.sourceApp,
    intent: request.intent,
    input: request.input ?? {},
    context: request.context ?? {},
    preferredMode: request.preferredMode ?? "local-first",
  };
  return `Read-only Prism AI request:\n${JSON.stringify(payload, null, 2)}`;
}

export function parseStructuredResponse(response: string): unknown | null {
  const trimmed = response.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const embedded = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (embedded) {
    try {
      return JSON.parse(embedded[1]);
    } catch {}
  }

  return null;
}

function normalizeString(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: `${field} must be a non-empty string` };
  }
  return { ok: true, value: value.trim().slice(0, 2000) };
}

function optionalRecord(value: unknown, field: string): { ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: undefined };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `${field} must be an object when provided` };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function normalizePreferredMode(value: unknown): AiRequestInput["preferredMode"] {
  if (value === "local-only" || value === "balanced") return value;
  return "local-first";
}
