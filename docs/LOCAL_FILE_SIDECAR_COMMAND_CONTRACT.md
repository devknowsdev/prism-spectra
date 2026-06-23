# Local File Sidecar Command Contract

Last-Updated: 2026-06-23

This document freezes the public contract for the explicit-file sidecar command
pipeline in `prism-spectra`.

It describes the current orchestration flow:

`planner -> recommendation -> write plan -> optional approved executor -> command result`

The command is intended for one explicitly named source file at a time. It is
not an ingest scanner, and it must not be interpreted as folder-level
ingestion.

## Supported Modes

- `plan_only`
- `execute_approved`

## Safety Guarantees

- explicit-file-only
- no folder scanning
- no recursive traversal
- no watcher
- no database
- no media processing
- no external API calls
- no source-file writes
- sidecar writes only in `execute_approved`
- sidecar writes require explicit `local_write` approval
- existing filesystem adapter and path guard boundaries are used

## Public Result Shape

Callers should expect the command result to expose these concepts:

- planner result
- recommendation
- write plan
- optional execution result
- final command status
- reasons
- warnings

The exact concrete object shape is implementation-specific, but the concepts
above are the stable contract.

## Expected Outcomes

### Missing sidecar

- planner detects a present source file and a missing adjacent sidecar
- recommendation should point to `create_sidecar`
- `plan_only` returns a preview only
- `execute_approved` may create the sidecar only after approval

### Ready sidecar

- planner detects a present source file and a valid matching sidecar
- recommendation should be `ready`
- the command should not execute a write plan for the ready case

### Stale sidecar

- planner detects valid sidecar metadata whose hash or size no longer matches
- recommendation should point to `update_sidecar_hash`
- `execute_approved` may refresh only the hash and size fields, plus the
  update timestamp

### Malformed sidecar

- planner detects a sidecar file that exists but is not valid JSON or is not
  valid sidecar data
- recommendation should be `review_sidecar`
- the command should not overwrite the malformed file

### sourcePath mismatch

- planner detects a valid sidecar that describes a different source path
- recommendation should be `review_sidecar`
- the command should not overwrite the existing sidecar

### Missing source

- planner detects that the requested source file is missing
- the command should return a blocked or missing-source style result, depending
  on the existing adapter contract

### Blocked or unsafe path

- existing path guard behavior should reject the request
- the command should return a blocked style result

## Integration Guidance

Future Prism repos should treat this API as a small, safe contract surface:

- pass one explicit source path
- use `plan_only` as a read-only preview
- require human or user approval before `execute_approved`
- treat Prism sidecars as local metadata, not media analysis output
- do not infer folder ingestion from this API

## Relationship To The Pipeline

The command composes the existing canonical helpers rather than redefining the
contract in each caller:

- `planLocalFileRoundTrip()`
- `recommendSidecarAction()`
- `planSidecarWrite()`
- `executeSidecarWritePlan()`

Canonical sidecar semantics remain in `src/ingest/sidecar.ts`.

