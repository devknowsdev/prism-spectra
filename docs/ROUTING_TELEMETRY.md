# Routing Telemetry and Cache Hardening

Last-Updated: 2026-06-29

## Status

Spectra routing currently has:

- Tier 2b L1 classification and confidence-aware fallback.
- Tier 3a semantic response cache.
- Tier 3b route decision hints wired into `ExecutionEngine`.

## Route cache boundary

The route decision cache is advisory only.

It may remember:

- model role hints
- paid-provider preference hints
- similarity score metadata

It must not become authoritative memory and must not bypass:

- local-first routing order
- provider availability checks
- ledger budget checks
- explicit escalation rules

## Current telemetry fields

Node logs may include:

```ts
routeCacheHit?: boolean;
routeCacheSimilarity?: number;
cacheHitKind?: "exact" | "semantic";
confidenceScore?: number | null;
fallbackReason?: string;
ledgerChainTried?: { provider: string; allowed: boolean; reason?: string }[];
```

AI request provenance may include:

```ts
routeCacheHit?: boolean;
routeCacheSimilarity?: number;
chainTried: { provider: string; allowed: boolean; reason?: string }[];
```

## Hardening rule

Route hints can influence provider ordering only after the router has performed the usual tier checks. They are not permission to call a provider.
