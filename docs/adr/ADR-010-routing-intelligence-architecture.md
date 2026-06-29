# ADR-010: Routing Intelligence Architecture

**Status:** Accepted
**Date:** 2026-06-29
**Track:** Track A

## Context

Spectra has a functional multi-tier router (`src/routing/router.ts`) that selects
models in cost-ascending order: Ollama → free_tier → paid (GPT/Claude). As of
Tier 2a:

- `classifyIntent()` exists in `src/executors/ollama.ts` as a standalone
  primitive but is **not wired** into the execution path.
- `localTierAvailable()` is a **stub** that always returns `true`.
- The pattern cache (`src/memory/patternCache.ts`) uses exact SHA-256 hash
  matching only — no semantic or fuzzy matching.
- The learning loop tracks `(provider, node_type)` success/cost/latency in
  `routing_weights` but cannot break ties at the local tier or route by task type.

The result is that routing is cost-ascending but not task-aware. A complex
reasoning query and a simple code completion are treated identically at the
router layer. This ADR establishes the architecture for task-aware routing
intelligence built on top of the existing tier chain.

## Critical mental model

The cascade pattern is **not** "always try local first, then escalate."
That framing burns latency on tasks the router has already classified as
cloud-appropriate.

The correct model is:

```
Route decision → select primary model (local OR cloud)
              → execute
              → quality-gate check
              → escalate only if quality < threshold
```

Cascade is a **safety net for routing mistakes**, not a default execution
strategy. For a query classified as clearly cloud-appropriate, Spectra goes
directly to the cloud model. No local attempt is made. The cascade only
activates when the routed model underperforms.

## Decision

Routing intelligence is built in four layers, delivered in order:

### Layer 1 — Cascade quality-gate (Tier 2b)

Wire `classifyIntent()` into `OllamaExecutor.execute()`. This makes the local
tier actually task-aware at the point of execution rather than routing
blindly.

Wire `localTierAvailable()` to use the real Ollama health probe result (already
captured at startup) rather than always returning `true`.

Define confidence scoring for local model output:

- **Primary signal:** mean log probability from Ollama `/api/generate`
  (`logprobs` field). Lower mean logprob → lower confidence.
- **Heuristic signals (additive):** response contains uncertainty phrases
  ("I'm not sure", "I don't know", "I cannot"), response is suspiciously
  short for the classified task type, response contains unfilled placeholder
  text.
- **Composite score:** weighted sum. Escalation threshold configurable via
  env var (default: 0.4). UI should expose this as a tunable.

When composite score < threshold: escalate to next tier, log the fallback
reason in the event ledger.

**Constraints:**
- All calls to `classifyIntent()` must acquire `ModelLock` before execution.
  `classifyIntent()` changes the active Ollama model context and must not run
  concurrently with other Ollama calls.
- Cascade escalation must be logged with: original tier, fallback tier,
  confidence score, and task classification.

### Layer 2 — L1 heuristic classification (Tier 2b, parallel to cascade wiring)

Pure string-operation pre-classifier. No model calls. Target latency < 5ms.

Signals:
- Query length (token count estimate — split on whitespace, multiply by 0.75).
- Keyword presence: code indicators (`def `, `function`, `class`, `import`,
  `const`, `async`, backtick fences), reasoning indicators (`why`, `explain`,
  `analyse`, `compare`, `evaluate`, `step by step`), creative indicators
  (`write a`, `story`, `poem`, `imagine`).
- Explicit domain tags in node metadata (`node_type` field already exists).

Output: `{ taskClass: 'code' | 'reasoning' | 'creative' | 'general' | 'unknown', confidence: number }`.

L1 result feeds into model role selection (`selectModelForRole()`) so the right
local model is attempted first. L1 result is also stored in the event ledger
for later telemetry analysis.

### Layer 3 — Semantic caching (Tier 3a)

Dual-layer cache, extending the existing `PatternCache`:

- **Layer A (already exists):** Exact SHA-256 hash match on
  `(node_type + intent + context)`. Sub-millisecond. No change needed.
- **Layer B (new):** Vector similarity search on Ollama embeddings.
  Embed the incoming query using the local embedding model
  (`nomic-embed-text` or `bge-m3` depending on RAM posture).
  Compare against a flat in-memory vector store (cosine similarity).
  Configurable similarity threshold (default: 0.92).
  Return cached response if threshold exceeded.

Cache TTL policy (configurable per task class):
- `code`: 15 minutes. Code-generation responses go stale as dependencies change.
- `reasoning` / `creative`: 2 hours.
- `general`: 1 hour.
- Override via env var `SPECTRA_CACHE_TTL_<CLASS>=<seconds>`.

Cache pre-flight order is strictly sequential:
1. Layer A (exact match) — cache hit → return, skip budget and model calls.
2. Layer B (semantic match) — cache hit → return, skip budget and model calls.
3. Budget gate — only reached on full cache miss.
4. Route decision → execute.

**Stability requirements:**
- The embedding model must be kept warm via a background keepalive ping at
  a configurable interval (default: 3 minutes) when the daemon is running.
  Cold-start on M1 can take 10–30 seconds and breaks the cache pre-flight
  latency promise.
- Embedding model failure must not crash the cache layer. On error: log
  degradation, skip Layer B, continue with Layer A only.

### Layer 4 — L2 embedding classification (Tier 3b)

Route matching via Ollama embeddings. Defines named route categories with
utterance examples:

| Route | Maps to role | Example utterances |
|---|---|---|
| `code` | `coder` | "write a TypeScript function", "fix this bug", "refactor this" |
| `reasoning` | `reasoner` | "explain why", "compare these", "analyse the trade-offs" |
| `creative` | `general` | "write a short story", "brainstorm names", "draft a poem" |
| `data` | `planner` | "summarise this CSV", "extract the key figures", "classify these items" |
| `general` | `general` | (fallback) |

At startup: embed all route utterance examples. On query: embed the query,
compute cosine similarity against each route's centroid, select highest-scoring
route above a minimum threshold (default: 0.75). Below threshold → `general`.

L2 failure fallback: if embedding call fails or times out, fall back to L1
result. Log the degradation. Do not block execution.

L2 replaces `classifyIntent()` for the classification role once it is stable.
`classifyIntent()` (which uses an LLM call) becomes the fallback for ambiguous
queries where L1 and L2 both return low confidence.

## Route decision caching

Cache the routing decision itself, separate from the response cache.

If `(query_fingerprint → route)` has been seen N times with consistent outcome,
cache the decision with a short TTL (default: 10 minutes). Subsequent similar
queries skip L1 and L2 and go directly to the pre-selected model.

This is a metadata cache, not an output cache. It caches "which model to use"
not "what the model said."

## Provider isolation and circuit breaker

Provider isolation is an implementation detail of the cascade executor, not a
separate concern. The cascade executor operates through an isolated provider
adapter layer.

Circuit breaker rule: if a provider returns errors on N consecutive calls
(default N = 3), open the circuit for that provider. Stop routing to it.
Test again after a backoff window (default: 60 seconds, exponential backoff
to 10 minutes). Log circuit state transitions.

## Warm routing

Track model selection history per session. If ≥ 80% of recent queries are
hitting the same local model, send a background keepalive to ensure it stays
loaded in Ollama. Models not routed to in the last M minutes (default: 10)
are candidates for eviction from the keepalive list.

This converts cold-start from a recurring latency penalty into a one-time
startup cost per session.

## Telemetry

Minimum telemetry event for each request — appended to the event ledger:

```typescript
{
  request_fingerprint: string;   // SHA-256 of (node_type + intent)
  l1_class: string;              // L1 classification result
  l2_class: string | null;       // L2 result if run
  model_selected: string;        // actual model used
  provider: string;
  response_latency_ms: number;
  output_tokens: number;
  confidence_score: number | null;
  escalated: boolean;
  cache_hit: 'exact' | 'semantic' | 'route' | null;
  fallback_reason: string | null;
}
```

This dataset is what allows routing thresholds to be tuned over time. Without
it, the system stays static regardless of volume.

## Model capability profiles

Every model in the pool needs a metadata record. This belongs in a
configuration file the daemon loads at startup (not hardcoded). Fields:

- `role`: one of `ModelRole` (classifier, planner, reasoner, coder, fallback)
- `context_window`: integer (tokens)
- `speed_toks_per_sec`: number (measurable via Ollama API)
- `quality_tier`: `'local-small' | 'local-mid' | 'cloud-standard' | 'cloud-strong'`
- `cost_class`: `'free' | 'paid'`
- `cost_per_1k_tokens`: number | null
- `modalities`: string[]
- `data_boundary`: `'local' | 'remote_no_training' | 'remote_may_train'`
- `env_var_override`: string | null

The existing `LOCAL_MODEL_CATALOG` in `src/executors/ollama.ts` (Tier 2a) is
the seed. Extend it to include the full profile fields above.

## Build order

1. **Tier 2b — cascade quality-gate + L1 heuristic classification + `localTierAvailable()` real implementation.**
   Wire `classifyIntent()` through `ModelLock`. Add confidence scoring.
   Add L1 string classifier. This is one PR. No new dependencies.

2. **Tier 3a — semantic cache Layer B + embedding keepalive.**
   Extend `PatternCache` with vector similarity layer using Ollama embeddings.
   One PR. No new npm dependencies — Ollama `/api/embeddings` is already
   available via the existing Ollama client.

3. **Tier 3b — L2 embedding classification + route decision cache.**
   Add utterance-based route matching. Add metadata routing cache.
   One PR.

4. **Tier 4 — telemetry + model capability profiles.**
   Structured event logging per request. Full profile record for every model.
   One PR.

## Constraints

- All Ollama calls (execute, classify, embed) must go through `ModelLock`.
  Concurrent model switches on 16GB RAM are the failure mode being prevented.
- Warm routing and embedding keepalive are background tasks — they must not
  block request handling.
- Budget state must be persisted to disk (at minimum a flat JSON file flushed
  on write). In-memory-only budget history is lost on daemon restart.
- Track B files (`src/runtime/**`, `config/modelRegistry.ts`,
  `providers/ollamaClient.ts`, etc.) must not be expanded. The Track B
  `modelRegistry.ts` concept is worth reviving, but only by porting the
  relevant ideas into Track A's governed path.
- No hidden cloud escalation. All escalation events must be logged with reason.

## Consequences

- `localTierAvailable()` stub is replaced with a real probe-backed check.
- `classifyIntent()` becomes load-bearing — it must be tested with a live
  Ollama instance before Tier 2b merges.
- `PatternCache` grows a second layer but remains a single module.
- The event ledger grows a `routing_telemetry` table alongside
  `routing_weights`.
- Confidence threshold and cache TTLs are configurable via env vars and
  eventually via the UI.
