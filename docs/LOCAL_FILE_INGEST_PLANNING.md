# Local File Ingest Planning

Last-Updated: 2026-06-23

This document describes the planning-only helper layer for local files.
It is not an ingest pipeline.

## Goal

The helper layer provides a small, explicit way to reason about a single local
file and its adjacent `.prism.json` metadata without scanning folders or
persisting state.

## Helper surface

The canonical helpers live in `src/ingest/sidecar.ts`.

- `buildSidecarPath(sourcePath)` derives the adjacent sidecar path
- `createInitialSidecar(input)` produces a canonical sidecar object for later
  writing
- `validateSidecarShape(value)` normalizes parsed sidecar JSON
- `updateSidecarHashFields(sidecar, update)` refreshes hash and size metadata
- `buildSidecarPlan(input, sidecarValue)` turns a single file plus an optional
  parsed sidecar into a planning result
- `planLocalFileRoundTrip(input)` reads one explicit source file and its
  adjacent sidecar through safe filesystem helpers, then returns a read-only
  round-trip plan
- `recommendSidecarAction(plan)` turns a round-trip plan into a non-writing
  draft, patch, review, ready, or blocked recommendation
- `planSidecarWrite(recommendation)` turns a recommendation into an
  approval-gated write plan without writing anything

Compatibility re-exports remain available from `src/filesystem/localFilePlanning.ts`
for older callers.

## Plan states

- `candidate`: the source file is known, but the sidecar is missing
- `ready`: the sidecar is present and matches the source path
- `blocked`: the sidecar is malformed or describes a different source path

## Round-trip planner

`planLocalFileRoundTrip()` is read-only and explicit-file-only.

- it inspects one source path and the adjacent `.prism.json` path only
- it does not scan folders or recurse
- it does not write sidecars
- it does not process media
- it does not call external APIs
- it does not create database state
- it uses existing safe read/stat helpers supplied by the caller

`recommendSidecarAction()` is recommendation-only.

- it does not write files
- it does not scan folders
- it does not compute hashes
- it does not call external APIs
- it does not create database state
- proposed drafts and patches are informational until a later write sprint

`planSidecarWrite()` is write-plan-only.

- it does not write, create, update, delete, move, or rename files
- planned writes require `local_write` approval and a later execution sprint
- it does not scan folders
- it does not watch files
- it does not use a database
- it does not process media
- it does not call external APIs
- it does not perform destructive operations

## What this layer does not do

- no directory traversal or folder crawling
- no file watching
- no write operations
- no database persistence
- no media analysis
- no external API calls
- no destructive file operations

## Intended usage

The expected flow is:

1. a caller identifies one file explicitly
2. the caller optionally reads the adjacent `.prism.json` file later, using the
   existing filesystem adapter or another explicit read path
3. the caller feeds the parsed JSON into `buildSidecarPlan()`
4. downstream orchestration decides whether to ingest, defer, or discard the
   candidate

## Deferred ideas

- folder-level manifests
- automatic ingestion queues
- persistent ingest state
- watcher-driven refresh
- media classification
- publish-time enrichment
