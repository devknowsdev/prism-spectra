# Sprint 011 — Embedding Foundation

## Objective

Establish governance for deterministic, replayable embedding infrastructure before implementation.

Sprint 011 remains the Embedding Foundation sprint. No embedding generation, retrieval implementation, or runtime behavior changes are included in this reconciliation.

## Governance

- Ledger Is Canonical Memory
- Embeddings Are Derived Indexes
- Retrieval Is Advisory
- Replayable Retrieval
- Vector Store Is Rebuildable Cache

## Sprint Scope

Phase 1:
- Governance alignment
- ADR ratification
- Planning and roadmap updates

Future implementation phases may introduce embeddings and retrieval only after governance is established.

## Constraints

- Do not modify runtime behavior
- Do not implement embeddings
- Do not implement retrieval
- All retrieval outputs must be replayable from ledger state
- Vector indexes must be rebuildable from canonical ledger records

## Planned Components (Future Work)

src/embeddings/*
src/retrieval/*

These paths remain planned and are not implemented by this sprint.

## ADRs

ADR-005 Ledger Is Canonical Memory
ADR-006 Embeddings Are Derived Indexes
ADR-007 Retrieval Is Advisory
ADR-008 Replayable Retrieval
ADR-009 Vector Store Is Rebuildable Cache