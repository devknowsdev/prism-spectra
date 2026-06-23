# Explicit File Sidecar Final Audit

Last-Updated: 2026-06-23

## Audit Summary

- baseline commit: `048cf48` `docs: freeze sidecar validation report contract`
- subsystem status: coherent, documented, exported, and regression-covered
- integration readiness verdict: ready for future Prism repo integration

This audit closes out the explicit-file sidecar subsystem delivered across
Sprints 008-021.

## File Map

- `src/ingest/sidecarTypes.ts`: canonical sidecar fields, schema version
  constant, suffix, and type definitions
- `src/ingest/sidecar.ts`: canonical sidecar helper/validation semantics
- `src/ingest/localFileRoundTripPlanner.ts`: read-only single-file planner
- `src/ingest/sidecarRecommendation.ts`: planner-to-recommendation mapping
- `src/ingest/sidecarWritePlan.ts`: approval-gated write-plan builder
- `src/ingest/sidecarWriteExecutor.ts`: approved sidecar-only write executor
- `src/ingest/localFileSidecarCommand.ts`: explicit-file orchestration command
- `src/ingest/sidecarValidationReport.ts`: read-only validation report for one
  explicit source file / sidecar pair
- `src/ingest/sidecarApprovalReview.ts`: read-only approval review model for
  one explicit source file / sidecar pair
- `src/ingest/index.ts`: public ingest barrel export
- `src/index.ts`: package-level public export surface
- `docs/LOCAL_FILE_SIDECAR_CONVENTION.md`: sidecar naming, schema versioning,
  and validation rules
- `docs/LOCAL_FILE_INGEST_PLANNING.md`: planner, recommendation, write-plan,
  executor, and command overview
- `docs/LOCAL_FILE_SIDECAR_COMMAND_CONTRACT.md`: frozen command contract
- `docs/LOCAL_FILE_SIDECAR_COMMAND_EXAMPLES.md`: integration examples
- `docs/LOCAL_FILE_SIDECAR_HANDOVER.md`: implementation handover packet
- `docs/LOCAL_FILE_SIDECAR_VALIDATION_REPORT_CONTRACT.md`: frozen validation
  report contract
- `test/run.ts`: regression coverage for planner, recommendation, write plan,
  executor, command, examples, schema versioning, and validation reporting

## Public Entry Points

- `runLocalFileSidecarCommand()`
- `validateLocalFileSidecar()`
- `buildSidecarApprovalReview()`
- `buildSidecarPath()`
- `createInitialSidecar()`
- `validateSidecarShape()`
- `updateSidecarHashFields()`
- `planLocalFileRoundTrip()`
- `recommendSidecarAction()`
- `planSidecarWrite()`
- `executeSidecarWritePlan()`

These are re-exported through `src/ingest/index.ts` and, where appropriate,
`src/index.ts`.

## Pipeline Coherence

The intended pipeline remains:

`sourcePath -> round-trip planner -> recommendation -> write plan -> optional approval-gated executor -> explicit-file command`

The validation-report path remains:

`sourcePath -> round-trip planner -> validation report`

## Safety Guarantees

- explicit-file-only
- no folder scanning
- no watcher
- no DB
- no media processing
- no external API calls
- no source-file writes
- sidecar-only writes
- approval-gated writes
- no migrations
- no batch upgrades
- no CLI additions
- no destructive source-file operations

The docs and implementation agree that Prism sidecars are local metadata, not
media analysis output.

## Schema Versioning

- current schema version is `1`
- new sidecars emit `schemaVersion: 1`
- legacy sidecars without `schemaVersion` are accepted
- unsupported future versions are review-only / blocked from automatic use
- no automatic migration exists

## Validation Report Contract

- the validation report is read-only
- it does not call the executor
- it reports `valid`, `review_needed`, `missing`, and `blocked` states
- it distinguishes `current`, `legacy_missing`, `unsupported`, and
  `not_applicable` schema-version states
- capability flags are hints, not automatic permission to execute

## Test Coverage Summary

The current test suite covers:

- sidecar draft creation
- sidecar shape validation
- planner outcomes for missing, ready, stale, malformed, mismatched, missing
  source, and unsafe path cases
- recommendation layer behavior
- write-plan layer behavior
- approval-gated executor behavior
- explicit-file command behavior
- command contract and examples
- schema versioning semantics
- validation report semantics
- approval review semantics
- JSON-serializable command and report results
- no-write behavior where required

## Known Non-Goals

- folder ingest
- watcher daemon
- recursive traversal
- media analysis
- audio/video classification
- database indexing
- remote sync
- external API enrichment
- migration runner
- batch upgrades
- autonomous execution
- CLI-based ingestion

## Integration Readiness

The subsystem is ready for future Prism repo integration because:

- the canonical sidecar semantics are centralized
- the explicit-file planner is read-only
- the recommendation and write-plan layers stay separate
- the executor is approval-gated and sidecar-only
- the command surface is explicit-file-only
- the validation report gives a safe preview of sidecar usability
- the documentation now freezes the public contracts and examples

## Recommended Next Subsystem Options

- explicit batch planner preview, no writes
- adapter contract hardening
- Prism Beam integration handoff
- test organization cleanup

Do not treat any of the options above as permission to add autonomous media
ingestion yet.
