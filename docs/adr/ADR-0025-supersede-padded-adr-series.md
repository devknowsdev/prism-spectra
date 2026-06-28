# ADR-0025 — Supersede padded ADR series (ADR-0009 through ADR-0024)

**Date:** 2026-06-28
**Status:** Accepted
**Decided by:** Dave Knowles + Claude (Sonnet 4.6)

## Context

`docs/adr/` contains two separate numbering tracks:

- ADR-005 through ADR-009 (no padding): embeddings-as-derived-indexes,
  vector-stores-as-rebuildable-caches, retrieval-advisory. Directionally
  consistent with Track A live code and with prism-beam's deep-research-report.

- ADR-0009 through ADR-0024 (4-digit padded): "Intelligence Operating System,"
  CapabilityGraph, Progressive Autonomy (up to Level 5 Background Autonomy),
  Workspace-Centric Execution. No source file references any of these by number.
  No Track A code aligns with them. Pattern matches the over-generalisation
  that produced Track B and was subsequently corrected per ARCHITECTURE_DRIFT_REPORT.md
  and MIGRATION_PLAN.md.

## Decision

The padded ADR series (ADR-0009 through ADR-0024) is formally superseded and
treated as historical only. It describes an architectural direction that was
evaluated and rejected for the same reasons Track B was rejected: it assumes
a hardware profile and operational complexity that does not match the real
system (single M1 Mac, 16GB RAM, local-first, one Ollama instance).

The active ADR series is ADR-005 through ADR-009 (unpadded). New ADRs follow
the padded numbering (ADR-0025+) to avoid collisions, but build toward the
unpadded series' constraints, not the superseded vision.

## Consequences

- Future AI sessions must not build toward capability graphs, autonomy levels,
  or workspace-centric execution as described in ADR-0009–0024 without an
  explicit new decision recorded here.
- The padded ADR files are retained for history; they are not deleted.
- This ADR is the canonical record of the decision. prism-beam AI_PROGRESS_LOG.md
  will record the session that produced it.
