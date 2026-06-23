# Agent Architecture Map

Last-Updated: 2026-06-23

## 1. Current Baseline

- latest baseline commit: `ae39454` `feat: add read-only sidecar approval review model`
- current active subsystem: explicit-file sidecar subsystem
- sidecar track status: closed / integration-ready
- Sprint 021 status: approval review model added

## 2. Repo Role In Prism Cluster

`prism-spectra` is the local AI / ingest / sidecar / orchestration capability repo in the Prism cluster.

- it is not yet a media processor
- it is not yet a watcher/indexer
- it is not yet a database-backed system
- it is not yet a cross-repo coordinator

`prism-beam` is the intended cluster coordination spine, but this sprint does not modify it.

## 3. Active Public Entry Points

Current public ingest surface:

- `runLocalFileSidecarCommand`
- `validateLocalFileSidecar`
- `buildSidecarApprovalReview`
- `buildSidecarPath`
- `buildSidecarPlan`
- `createInitialSidecar`
- `validateSidecarShape`
- `updateSidecarHashFields`
- `planLocalFileRoundTrip`
- `recommendSidecarAction`
- `planSidecarWrite`
- `executeSidecarWritePlan`

Exports flow through:

- [src/ingest/index.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/index.ts)
- [src/index.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/index.ts)

## 4. Sidecar Pipeline Map

Write-capable path:

```text
sourcePath
-> localFileRoundTripPlanner
-> sidecarRecommendation
-> sidecarWritePlan
-> optional approval-gated sidecarWriteExecutor
-> localFileSidecarCommand
```

Read-only validation path:

```text
sourcePath
-> localFileRoundTripPlanner
-> sidecarValidationReport
```

Read-only approval review path:

```text
planner / recommendation / writePlan / validationReport
-> sidecarApprovalReview
```

## 5. Validation / Approval / Execution Separation

- `planLocalFileRoundTrip()` inspects one explicit source file and adjacent sidecar state
- `validateLocalFileSidecar()` summarizes usability without writing
- `buildSidecarApprovalReview()` turns existing planner or report objects into a UI-facing review
- `planSidecarWrite()` converts recommendation intent into a write plan
- `executeSidecarWritePlan()` is still the only execution step

Approval review is display-only. It does not grant execution permission.

## 6. File Ownership Map

- [src/ingest/sidecarTypes.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/sidecarTypes.ts): canonical sidecar fields, schema version, suffix, and type shapes
- [src/ingest/sidecar.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/sidecar.ts): sidecar creation, shape validation, hash-field updates, and path helpers
- [src/ingest/localFileRoundTripPlanner.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/localFileRoundTripPlanner.ts): read-only explicit-file planner
- [src/ingest/sidecarRecommendation.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/sidecarRecommendation.ts): planner-to-recommendation mapping
- [src/ingest/sidecarWritePlan.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/sidecarWritePlan.ts): approval-gated write-plan builder
- [src/ingest/sidecarWriteExecutor.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/sidecarWriteExecutor.ts): approved sidecar-only write executor
- [src/ingest/localFileSidecarCommand.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/localFileSidecarCommand.ts): explicit-file orchestration command
- [src/ingest/sidecarValidationReport.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/sidecarValidationReport.ts): read-only validation report
- [src/ingest/sidecarApprovalReview.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/ingest/sidecarApprovalReview.ts): read-only approval review model
- [test/run.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/test/run.ts): regression coverage and contract checks

## 7. Adapter Boundary Map

- [src/adapters/types.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/adapters/types.ts): adapter contract, risks, approval requirements
- [src/adapters/approvalGuard.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/adapters/approvalGuard.ts): approval gating and blocked-result helpers
- [src/adapters/filesystemPathGuard.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/adapters/filesystemPathGuard.ts): path boundary enforcement
- [src/adapters/filesystemAdapter.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/src/adapters/filesystemAdapter.ts): local filesystem execution boundary
- [docs/ADAPTER_CONTRACTS.md](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/docs/ADAPTER_CONTRACTS.md): adapter contract notes and safety stance

Current adapter stance:

- explicit approval is required for higher-risk actions
- filesystem boundaries are enforced before local writes
- local sidecar work remains sidecar-only

## 8. Closed Boundaries

The explicit-file sidecar subsystem is closed and should not be casually changed.

- no folder scanning
- no watcher
- no DB
- no media processing
- no audio/video analysis
- no external APIs
- no source-file writes
- no sidecar writes outside approved executor paths
- no migrations
- no batch upgrades
- no CLI expansion
- no destructive file operations

## 9. Forbidden Expansions

- do not turn the sidecar subsystem into folder ingest
- do not add execution permission to the approval review model
- do not add shared packages before two real consumers exist
- do not duplicate planner or recommendation internals in new callers
- do not expand into coordinator or media-analysis territory in this sprint

## 10. Test Coverage Map

Coverage currently lives in [test/run.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/test/run.ts):

- sidecar draft creation and shape validation
- planner outcomes for missing, ready, stale, malformed, mismatched, missing source, and blocked cases
- recommendation layer behavior
- write-plan layer behavior
- approval-gated executor behavior
- command behavior for `plan_only` and `execute_approved`
- validation report semantics
- approval review semantics
- JSON-serializable outputs
- no-write behavior where required

Validation command set:

```bash
npm test
npm run typecheck
npm run build
```

## 11. Prism Lexicon Terms

- explicit-file sidecar subsystem
- sidecar approval review
- `approval_required`
- `not_applicable`
- `blocked`
- `local_write`
- `proposedOperation`
- `userFacingChanges`
- `safetyChecks`
- `canApprove`
- `canExecuteWithApproval`
- `review_sidecar`
- `update_sidecar_hash`
- `validateLocalFileSidecar`
- `buildSidecarApprovalReview`

## 12. Shared Capability Candidates

Possible future cluster-sharing candidates, only after real reuse pressure:

- sidecar path / schema helpers
- approval review display model
- adapter contract utilities
- explicit-file planner patterns

Do not package these yet. Copy first, package later.

## 13. Safe Next Sprint Lanes

- explicit batch planner preview, no writes
- adapter contract hardening
- Prism Beam integration handoff
- test organization cleanup

## 14. Fast Orientation Checklist For Agents

1. Confirm the baseline commit is `ae39454`.
2. Read the current file map before changing anything.
3. Treat the sidecar pipeline as explicit-file only.
4. Keep validation, approval review, and execution separate.
5. Respect the closed-boundary list.
6. Prefer `src/ingest/index.ts` and `src/index.ts` for public entry-point checks.
7. Use [test/run.ts](/Users/duif/DK%20APP%20DEV/PRISM/prism-spectra/test/run.ts) to see what is already covered.
8. If a change feels cluster-wide, stop and confirm reuse pressure first.

