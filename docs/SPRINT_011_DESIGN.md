# Sprint 011 — Embedding Foundation

## Objective

Introduce deterministic local-first embeddings and retrieval.

## Model

Recommended: BGE Base

## Storage

Phase 1: SQLite
Phase 2: sqlite-vec

## Files

src/embeddings/embeddingTypes.ts
src/embeddings/embeddingModel.ts
src/embeddings/embeddingGenerator.ts
src/embeddings/embeddingStore.ts
src/embeddings/embeddingEvents.ts

src/retrieval/retrievalTypes.ts
src/retrieval/similarity.ts
src/retrieval/retrievalEngine.ts
src/retrieval/retrievalValidator.ts
src/retrieval/retrievalCoordinator.ts

## ADRs

ADR-005 Deterministic Embeddings
ADR-006 Ledger Linked Retrieval
ADR-007 Local Embeddings Only
ADR-008 Replayable Retrieval
ADR-009 Vector Store Is Cache
