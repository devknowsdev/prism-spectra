# Local File Sidecar Approval Review

Last-Updated: 2026-06-23

This document freezes the read-only approval review model for explicit-file
sidecar work in `prism-spectra`.

## Purpose

- convert existing planner, recommendation, write-plan, or validation states
  into a caller-facing approval review object
- give a UI or another Prism repo a stable preview surface before any write
- keep approval decisions separate from execution

## Input / Output

- input: one existing sidecar state object, or a small bundle of them
- output: `SidecarApprovalReview`

The review object summarizes whether approval is required, unnecessary, or
blocked. It is JSON-serializable and designed for UI display.

## No-Write Guarantee

- read-only only
- no filesystem adapter calls
- no write executor calls
- no source-file writes
- no sidecar writes
- no scanning, watcher, DB, media, or external API work

## Relationship To Write Plan And Executor

- the write plan remains the authoritative source for approved sidecar
  operations
- the executor still performs the actual approved write
- this helper only displays the approval state and proposed change surface

## Safety Boundaries

- explicit-file-only
- approval is never execution
- `local_write` is a review concept here, not a permission grant
- blocked, malformed, mismatched, unsupported, or missing-source states stay
  blocked
- approved writes still require the existing approval gate and executor checks

## Future Prism Relevance

- a Prism UI can use this object to render approve, not applicable, or blocked
  states without re-implementing planner logic
- Prism Beam or another Prism repo can consume the same contract as a
  lightweight review preview
- the model stays small enough to copy before any shared package is justified

## Lexicon Terms Introduced Or Preserved

- `SidecarApprovalReview`
- `buildSidecarApprovalReview`
- `approval_required`
- `not_applicable`
- `blocked`
- `local_write`
- `proposedOperation`
- `userFacingChanges`
- `safetyChecks`
- `canApprove`
