# Adapter Contracts

Last-Updated: 2026-06-23

This document describes the adapter scaffold now available under `src/adapters/`.
It is a documentation and test-oriented contract layer, not a production
integration layer.

## Purpose

Adapters are the boundary objects used by prism-spectra to model capability
execution. They help the engine distinguish between:

- local-only operations
- local writes
- external drafts
- external writes
- destructive operations

The scaffold is intentionally conservative:

- no real external APIs are wired
- no publishing or email delivery happens
- no hidden approvals are assumed
- no dependency additions are required

## Core contract shape

An adapter contract carries:

- identity and kind
- execution mode
- approval posture
- declared capabilities
- optional health reporting
- a single `execute()` surface

The shared types live in `src/adapters/types.ts`.

## Approval model

Approval is a first-class part of the contract.

- read-only actions may run without approval
- local writes may be recommended for approval
- external drafts are treated as lower-risk external actions
- external writes and destructive actions require explicit approval

Unknown or ambiguous high-risk behavior is blocked by default.

## Registry model

The registry in `src/adapters/registry.ts` is a lightweight in-memory
registration surface for:

- registering adapters
- listing adapters
- filtering by kind
- checking adapter health

It is meant to support orchestration, tests, and future wiring work.

## Mock adapters

The current mock implementations are intentionally deterministic:

- `createMockLocalModelAdapter()` for local model echoes
- `createMockFilesystemAdapter()` for in-memory file reads and writes
- `createMockGitAdapter()` for commit and push simulation
- `createMockExternalPublishingAdapter()` for draft/publish simulation

These mocks are useful for:

- contract tests
- orchestration prototypes
- approval gating checks
- documentation examples

## Filesystem Adapter

`createFilesystemAdapter()` is the first real local adapter in the scaffold.
It is constrained to explicit allowed roots and is designed for local-only
file operations.

### Supported operations

- `readTextFile`
- `writeTextFile`
- `listDirectory`
- `ensureDirectory`
- `statPath`
- `computeSha256`
- `writeJsonSidecar`
- `readJsonFile`
- `writeJsonFile`

### Path boundary rules

- every requested path is resolved against the adapter base directory or taken
  as an absolute path
- all configured allowed roots are resolved up front, and `baseDir` must live
  inside one of them
- `path_outside_allowed_roots` is used when a path starts outside the allowed
  set
- `path_traversal_blocked` is used for `..` traversal attempts, including
  nested traversal segments
- symlinks are rejected conservatively with `symlink_rejected`; the adapter
  does not follow them for reads or writes
- hard links are not treated as a special escape case; they are handled as
  ordinary files as long as the link path itself stays inside an allowed root
- the adapter does not trust hidden path jumps, mount tricks, or external
  escape hatches
- path checks are repeated immediately before writes and again after parent
  directory creation when practical, but the adapter still cannot eliminate all
  TOCTOU races
- file-not-found and directory-shape failures are surfaced with
  `file_not_found` and `not_a_directory`

### Approval and risk behavior

- read operations are `read_only`
- write operations are `local_write`
- the adapter records risk metadata on every result
- approval is not required by default for local writes, but explicit
  approval can still be supplied and will be captured in the result context

### Sidecar behavior

- `writeJsonSidecar` writes a deterministic JSON file next to the target file
- the default suffix is `.prism.json`, matching the local Prism sidecar
  convention documented in `docs/LOCAL_FILE_SIDECAR_CONVENTION.md`
- JSON output is stable and newline-terminated
- sidecar writes must pass the same path-boundary checks as normal writes, so
  a malicious suffix cannot escape an allowed root
- planning-only helpers in `src/ingest/sidecar.ts` can build and validate
  sidecar-shaped metadata without performing ingest, folder scans, or
  persistence

### Unsupported operations

- delete and recursive delete
- move or rename outside the adapter's simple local-safe scope
- chmod / chown
- shell execution
- file watching
- symlink management as a trusted path feature
- media processing
- database writes
- cloud sync
- other destructive filesystem operations that are not explicitly declared

### Future hardening options

Later hardening passes could add:

- fd-based open/write flows that reduce the remaining race window further
- path-specific operation locks for heavier local contention
- dedicated hard-link provenance checks if the product ever needs them
- audit logging for path boundary rejections
- a separate watcher capability with explicit approval and provenance rules
- stricter rename/move semantics if those operations are ever introduced

### Future file-watcher direction

If file watching is added later, it should be a separate, explicit capability
with its own approval and provenance rules. This sprint keeps the adapter
strictly read/write/path-boundary focused.

### Safety guarantees

- no operation may escape the configured allowed roots
- no destructive operation is implemented in this sprint
- no external integration is called
- no database or cloud state is touched
- all results carry provenance-friendly metadata

## Stable decisions

These decisions are now treated as the current architectural stance:

- adapters are capability-first
- approval checks happen before execution
- high-risk behavior is not implicit
- mock adapters are acceptable for local validation
- the registry is intentionally simple and in-memory

## Deferred decisions

The following are intentionally left for later phases:

- persistent adapter registration
- real provider implementations
- adapter-specific persistence schemas
- UI for adapter configuration
- external publishing integrations

## Related files

- [src/adapters/types.ts](../src/adapters/types.ts)
- [src/adapters/approvalGuard.ts](../src/adapters/approvalGuard.ts)
- [src/adapters/registry.ts](../src/adapters/registry.ts)
- [src/adapters/index.ts](../src/adapters/index.ts)
