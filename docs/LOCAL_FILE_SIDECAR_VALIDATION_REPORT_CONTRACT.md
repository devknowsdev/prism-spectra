# Local File Sidecar Validation Report Contract

Last-Updated: 2026-06-23

This document freezes the public contract for the read-only explicit-file
sidecar validation report in `prism-spectra`.

The report is a caller-facing summary of whether one explicit local source file
and its adjacent `.prism.json` sidecar are usable.

## Purpose

- inspect one explicit source file / sidecar pair
- report sidecar usability without writing anything
- summarize the current validation state for future Prism callers

## Public Entry Point

- `validateLocalFileSidecar(input: LocalFileRoundTripPlanInput): Promise<SidecarValidationReport>`

The exported report type and helper names come from:

- `src/ingest/sidecarValidationReport.ts`
- `src/ingest/index.ts`
- `src/index.ts`

The helper composes the existing read-only planner and does not invoke the
write executor.

## Safety Guarantees

- explicit-file-only
- read-only
- no sidecar writes
- no source-file writes
- no executor invocation
- no folder scanning
- no watcher
- no DB
- no media processing
- no external APIs
- no migrations
- no batch upgrades

The report uses the existing filesystem adapter and path guard boundaries via
the planner layer.

## Report Shape

`SidecarValidationReport` currently exposes these concepts:

- `status`
- `sourcePath`
- `sidecarPath`
- `sourceStatus`
- `sidecarStatus`
- `schemaVersionStatus`
- `issues`
- `recommendedAction`
- `canAutoPlan`
- `canExecuteWithApproval`

`issues` is an array of `{ code, severity, message }` entries.

## Report Status Semantics

### `valid`

- the source file is present
- the sidecar is structurally acceptable
- the sidecar is ready for caller use

### `review_needed`

- the sidecar is malformed, mismatched, stale, or uses an unsupported schema
  version
- the caller should review the report before deciding on a next action

### `missing`

- the source file is present
- the adjacent sidecar is missing
- the report can describe a future `create_sidecar` action, but no write
  happens here

### `blocked`

- the source file cannot be used safely
- the path is unsafe or otherwise blocked by the planner

## Schema Version Semantics

The report exposes these schema-version states:

- `current`
- `legacy_missing`
- `unsupported`
- `not_applicable`

### `current`

- the sidecar has the current Prism schema version

### `legacy_missing`

- the sidecar is otherwise valid but does not include `schemaVersion`
- this is accepted for read-only validation

### `unsupported`

- the sidecar declares a future or unsupported version
- the caller should treat the report as review-only

### `not_applicable`

- there is no sidecar data to inspect for schema version semantics
- this commonly occurs when the sidecar is missing or malformed

## Recommended Action Semantics

The report uses these recommendations:

- `none`
- `create_sidecar`
- `update_sidecar_hash`
- `review_sidecar`
- `blocked`

These are capability hints only. They are not permission to write.

### `none`

- the report is ready and no write is recommended

### `create_sidecar`

- the source file is present and the sidecar is missing

### `update_sidecar_hash`

- the sidecar exists but its hash or size metadata is stale

### `review_sidecar`

- the sidecar is malformed, mismatched, or unsupported

### `blocked`

- the source file or path is blocked and no sidecar action should be attempted

## Capability Flags

- `canAutoPlan` means the report can be turned into a future plan preview
- `canExecuteWithApproval` means the report could later feed an approval-gated
  write path

Neither flag implies automatic execution.

## Common Outcomes

| Scenario | status | schemaVersionStatus | recommendedAction | Notes |
| --- | --- | --- | --- | --- |
| ready current v1 sidecar | `valid` | `current` | `none` | JSON-serializable and read-only |
| legacy sidecar with missing `schemaVersion` | `valid` | `legacy_missing` | `none` | accepted without auto-migration |
| unsupported future schema version | `review_needed` | `unsupported` | `review_sidecar` | not auto-plannable or executable |
| missing sidecar | `missing` | `not_applicable` | `create_sidecar` | no file is written here |
| stale sidecar | `review_needed` | `current` | `update_sidecar_hash` | no file is written here |
| malformed sidecar | `review_needed` | `not_applicable` | `review_sidecar` | malformed JSON is not overwritten |
| sourcePath mismatch | `review_needed` | `current` | `review_sidecar` | existing sidecar is not overwritten |
| missing source | `blocked` | `not_applicable` | `blocked` | blocked by planner safety |
| unsafe / blocked path | `blocked` | `not_applicable` | `blocked` | blocked by existing path guard behavior |

## Integration Guidance

- validate one explicit source path before showing sidecar actions
- treat unsupported schema versions as review-only
- treat legacy missing `schemaVersion` as accepted but not auto-migrated
- use `plan_only` command mode for previews
- require human or user approval before any write path
- never infer folder ingestion from this report
- never infer media analysis from this report

## Relationship To The Pipeline

The validation report sits on top of the read-only planner:

`planLocalFileRoundTrip() -> validateLocalFileSidecar()`

It does not call the recommendation, write-plan, or executor layers directly.

## Related Docs

- [docs/LOCAL_FILE_SIDECAR_CONVENTION.md](docs/LOCAL_FILE_SIDECAR_CONVENTION.md)
- [docs/LOCAL_FILE_SIDECAR_HANDOVER.md](docs/LOCAL_FILE_SIDECAR_HANDOVER.md)
- [docs/LOCAL_FILE_SIDECAR_COMMAND_CONTRACT.md](docs/LOCAL_FILE_SIDECAR_COMMAND_CONTRACT.md)
