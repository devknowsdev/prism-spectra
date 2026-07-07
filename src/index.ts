// src/index.ts — public surface of the core engine package.
export * from "./types.js";
export { MemoryDB } from "./memory/db.js";
export { Ledger } from "./memory/ledger.js";
export { PatternCache } from "./memory/patternCache.js";
export { SemanticPatternCache, semanticSignature } from "./memory/semanticPatternCache.js";
export type { SemanticCacheEntry, SemanticCacheLookup, SemanticCacheOptions } from "./memory/semanticPatternCache.js";
export { TaskHistory } from "./memory/taskHistory.js";
export { LearningLoop } from "./intelligence/learningLoop.js";
export { GraphBuilder, staticFallbackNodes, toNodeInputs, WIZARD_MODES } from "./intelligence/graphBuilder.js";
export type { WizardMode, GraphBuilderInput, BuildOutcome, FailureNote } from "./intelligence/graphBuilder.js";
export { Router, classifyComplexity } from "./routing/router.js";
export { classifyTaskHeuristic } from "./routing/l1Classifier.js";
export type { L1Classification, TaskClass } from "./routing/l1Classifier.js";
export { RouteDecisionCache, paidProviderPreference, routeSignature } from "./routing/routeDecisionCache.js";
export type { RouteDecisionCacheEntry, RouteDecisionCacheOptions, RouteDecisionHint } from "./routing/routeDecisionCache.js";
export { TaskGraph } from "./taskGraph/graph.js";
export { CheckpointManager } from "./safety/checkpoint.js";
export { validate } from "./safety/validation.js";
export { FileLockManager } from "./engine/fileLock.js";
export { ExecutionEngine } from "./engine/executionEngine.js";
export {
  DEFAULT_EMBEDDING_KEEPALIVE,
  DEFAULT_EMBEDDING_MODEL,
  OllamaEmbeddingProvider,
  startEmbeddingKeepalive,
} from "./embeddings/ollamaEmbeddings.js";
export type { EmbeddingProvider, OllamaEmbeddingProviderOptions } from "./embeddings/ollamaEmbeddings.js";
export {
  AI_REQUEST_RISK_CLASSES,
  buildAiRequestIntent,
  normalizeAiRequestBody,
  parseStructuredResponse,
} from "./engine/aiRequest.js";
export type {
  AiRequestFailure,
  AiRequestInput,
  AiRequestResult,
  AiRequestRiskClass,
  AiRequestSuccess,
  AiRequestValidation,
} from "./engine/aiRequest.js";
export { buildExecutorRegistry } from "./executors/index.js";
export * from "./adapters/index.js";
export * from "./ingest/index.js";
export {
  buildPrismLocalFilePlan,
  createPrismSidecarDraft,
  prismSidecarPathFor,
  validatePrismSidecarMetadata,
} from "./filesystem/localFilePlanning.js";
export type {
  PrismLocalFilePlanInput,
  PrismSidecarDraft,
  PrismSidecarMetadata,
  PrismSidecarValidationResult,
} from "./filesystem/localFilePlanning.js";
export { Wizard, WizardPlan, MAX_QUESTIONS } from "./wizard/wizard.js";
export type { WizardQuestion } from "./wizard/wizard.js";
export { loadForgeConfig, ensureForgeDirs, exampleConfigPath, defaultForgePaths } from "./config/loadConfig.js";
export type { ForgeConfig } from "./config/loadConfig.js";
export { probeAllProviders, applyProviderProbe } from "./config/providerProbe.js";
export type { ProviderStatus } from "./config/providerProbe.js";
export * from "./events/index.js";
export * from "./sessions/index.js";
export * from "./approvals/index.js";
export * from "./capabilities/index.js";
export * from "./workbench/index.js";
