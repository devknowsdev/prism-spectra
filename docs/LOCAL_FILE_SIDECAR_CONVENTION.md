# Local File Sidecar Convention

Last-Updated: 2026-06-23

This document defines the local Prism sidecar convention used for planning
metadata beside a single file.

## Scope

- one sidecar per source file
- explicit file path only
- no folder scanning
- no ingest execution
- no database persistence
- no file watching

## Filename

- the sidecar path is the source file path plus `.prism.json`
- examples:
  - `song.md` -> `song.md.prism.json`
  - `notes/demo.txt` -> `notes/demo.txt.prism.json`

## Required contract fields

- `assetId`
- `sourcePath`
- `canonicalPath`
- `sha256`
- `sizeBytes`
- `createdAt`
- `updatedAt`
- `kind`
- `tags`
- `derivedFiles`
- `analysisStatus`
- `approvalState`
- `notes`

`src/ingest/sidecar.ts` provides `createInitialSidecar()` so callers can fill
these fields without inventing their own defaults.

## Field notes

- `assetId` is the stable identity for the asset
- `sourcePath` is the explicit source file path the plan is describing
- `canonicalPath` is the normalized canonical path for the asset
- `sha256` and `sizeBytes` are hash-derived file metadata
- `createdAt` and `updatedAt` use ISO-8601 timestamps
- `kind` is a caller-supplied asset classification label
- `tags`, `derivedFiles`, and `notes` are JSON arrays of strings
- `analysisStatus` and `approvalState` are human-readable workflow state labels

## Stability rules

- the sidecar describes one source file only
- the sidecar does not store the source file contents
- the source file remains canonical
- if the source path changes, the sidecar should be updated to match
- unknown fields are deferred until a future schema version instead of being
  relied on implicitly

## Example

```json
{
  "assetId": "asset-song-001",
  "sourcePath": "notes/demo.txt",
  "canonicalPath": "notes/demo.txt",
  "sha256": "sha256:...",
  "sizeBytes": 1234,
  "createdAt": "2026-06-23T00:00:00.000Z",
  "updatedAt": "2026-06-23T00:00:00.000Z",
  "kind": "note",
  "tags": ["planning", "prism"],
  "derivedFiles": ["notes/demo.pdf"],
  "analysisStatus": "pending",
  "approvalState": "unreviewed",
  "notes": ["planning metadata for a local note"]
}
```

## Related helper

- `src/ingest/sidecar.ts`
- `src/filesystem/localFilePlanning.ts` for compatibility exports
