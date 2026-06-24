# Event Ledger and Approval Queue

Sprint 025 adds the in-memory contracts that the Spectra Workbench can read for events and approvals.

## What this sprint adds

- An in-memory event ledger contract for timeline-style provenance.
- An in-memory approval queue contract for pending review state.
- Read-only workbench projections that can consume those contracts.

## What this sprint does not add

- No database persistence.
- No migrations.
- No execution path.
- No destructive capability execution.
- No approval execution.
- No sidecar behavior change.
- No heavy dependency integration.

Approval resolution only updates queue state and emits ledger events. It does not execute work.

Future write, destructive, expensive, or remote capability flows should request approval first and emit ledger events as they progress.

The workbench should continue to read these contracts rather than inventing new hidden state.

Persistence can be added later once the event shape and approval lifecycle have stabilized.

## Beam extraction candidates

These patterns may later belong in `prism-beam` as support guidance rather than runtime app logic:

- event ledger contract pattern
- approval queue contract pattern
- capability manifest validation pattern
- workbench data-spine pattern
- sprint prompt template
- repo hygiene checklist

## Boundary note

The explicit-file sidecar subsystem remains unchanged and closed to new behavior in this sprint.

