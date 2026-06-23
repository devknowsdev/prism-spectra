# Local File Sidecar Handover Packet

Last-Updated: 2026-06-23

This packet summarizes the explicit-file sidecar work completed across
Sprints 008-021 so another coding agent can integrate without re-reading every
prior sprint.

## Current Status

- explicit-file sidecar pipeline is implemented
- sidecar convention exists
- schema versioning exists
- planner exists
- validation report exists
- approval review model exists
- recommendation layer exists
- write-plan layer exists
- approval-gated executor exists
- explicit-file command exists
- contract and examples exist

## Pipeline Summary

`sourcePath -> localFileRoundTripPlanner -> sidecarRecommendation -> sidecarWritePlan -> sidecarWriteExecutor -> localFileSidecarCommand`

## Public Entry Point Guidance

Future callers should prefer `runLocalFileSidecarCommand()`, which is the
current exported command function name in the repo.

The command is re-exported from:

- `src/ingest/index.ts`
- `src/index.ts`

## Mode Guidance

- `plan_only`: safe preview, no writes
- `execute_approved`: sidecar-only writes, explicit `local_write` approval required

## Safety Boundaries

- explicit-file-only
- no folder scanning
- no watchers
- no DB
- no media analysis
- no external APIs
- no source-file writes
- sidecar-only writes
- approval-gated writes
- existing filesystem adapter and path guard boundaries

## Integration Checklist For Future Prism Repos

- create or obtain an allowed-root filesystem adapter
- pass one explicit source path
- run `plan_only` first
- show recommendation and write plan to the user
- require explicit human or user approval before `execute_approved`
- never infer folder ingestion
- never treat sidecar metadata as audio or video analysis
- preserve existing sidecar metadata on stale updates
- keep destructive operations out of this flow

## Known Non-Goals

- folder ingest
- watcher daemon
- media hashing beyond file hash
- audio/video analysis
- thumbnail generation
- database indexing
- remote sync
- external API enrichment
- batch operations
- destructive file operations
- CLI

## Suggested Next Sprints

- explicit batch planner preview, no writes
- import-sidecar validation report, no writes
- sidecar schema versioning, no migration
- fixture cleanup and test organization

## Validation Commands

```bash
npm test
npm run typecheck
npm run build
```

## File Map

- `src/ingest/sidecarTypes.ts`: canonical sidecar fields, schema version constant, suffix, and type definitions
- `src/ingest/sidecar.ts`: canonical sidecar semantics and helper functions
- `src/ingest/localFileRoundTripPlanner.ts`: read-only single-file planner
- `src/ingest/sidecarRecommendation.ts`: converts planner output into recommendation intent
- `src/ingest/sidecarValidationReport.ts`: read-only validation report over a single explicit file pair
- `docs/LOCAL_FILE_SIDECAR_VALIDATION_REPORT_CONTRACT.md`: frozen report semantics and caller guidance
- `src/ingest/sidecarWritePlan.ts`: turns recommendation intent into approval-gated write plans
- `src/ingest/sidecarWriteExecutor.ts`: revalidates and performs approved sidecar-only writes
- `src/ingest/localFileSidecarCommand.ts`: orchestration command that composes the pipeline
- `src/ingest/index.ts`: ingest barrel export
- `src/index.ts`: package-level public export surface
- `src/adapters/filesystemAdapter.ts`: filesystem adapter implementation
- `src/adapters/filesystemPathGuard.ts`: path boundary enforcement
- `src/adapters/approvalGuard.ts`: approval gating helpers
- `src/adapters/types.ts`: adapter contracts and operation types
- `docs/LOCAL_FILE_SIDECAR_CONVENTION.md`: sidecar format and naming convention
- `docs/LOCAL_FILE_INGEST_PLANNING.md`: read-only planning helpers and pipeline overview
- `docs/LOCAL_FILE_SIDECAR_COMMAND_CONTRACT.md`: frozen command contract
- `docs/LOCAL_FILE_SIDECAR_COMMAND_EXAMPLES.md`: copy-paste integration examples
- `test/run.ts`: regression coverage for planner, recommendation, write plan, executor, command, and adapter boundaries

## Regression Coverage Already Present

The existing test suite already covers the handover-relevant contract points:

- command exports
- JSON-serializable results
- `plan_only` no-write behavior
- `execute_approved` approval gate
- stale update metadata preservation
- unsafe path rejection

Because those behaviors are already covered, no new tests were needed for this sprint.
