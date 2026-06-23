# Local File Sidecar Command Examples

Last-Updated: 2026-06-23

These examples show how to consume the frozen explicit-file sidecar command
surface safely.

The examples assume:

- the caller already has one explicit source file path
- the caller has an allowed-root filesystem adapter
- sidecar writes are approval-gated
- the caller does not scan folders
- the caller does not process media

## Public Imports

Use the public package root or your repo's equivalent public entry point.

```ts
import {
  createFilesystemAdapter,
  runLocalFileSidecarCommand,
} from "ai-forge-core";
```

## `plan_only` Preview

This is the read-only preview path. It gathers a planner result,
recommendation, and write plan, but performs no writes.

```ts
const filesystemAdapter = createFilesystemAdapter({
  id: "filesystem-example",
  allowedRoots: [workspaceRoot],
  baseDir: workspaceRoot,
});

const preview = await runLocalFileSidecarCommand({
  mode: "plan_only",
  sourcePath: "notes/example.txt",
  filesystemAdapter,
});

console.log(preview.planner);
console.log(preview.recommendation);
console.log(preview.writePlan);
console.log(preview.status, preview.reasons, preview.warnings);
```

## `execute_approved` Create

This mode writes a sidecar only after explicit local-write approval.

```ts
const filesystemAdapter = createFilesystemAdapter({
  id: "filesystem-example",
  allowedRoots: [workspaceRoot],
  baseDir: workspaceRoot,
});

const created = await runLocalFileSidecarCommand({
  mode: "execute_approved",
  sourcePath: "notes/example.txt",
  filesystemAdapter,
  approval: { granted: true, approver: "user" },
});

console.log(created.status); // "written" when the sidecar is created
console.log(created.execution);
```

## `execute_approved` Without Approval

If approval is omitted, the command remains blocked and writes nothing.

```ts
const filesystemAdapter = createFilesystemAdapter({
  id: "filesystem-example",
  allowedRoots: [workspaceRoot],
  baseDir: workspaceRoot,
});

const blocked = await runLocalFileSidecarCommand({
  mode: "execute_approved",
  sourcePath: "notes/example.txt",
  filesystemAdapter,
});

console.log(blocked.status); // "blocked"
console.log(blocked.reasons);
```

## Stale Sidecar Update

When the sidecar is stale, the executor refreshes only the planned hash, size,
and update timestamp fields while preserving unrelated metadata.

```ts
const filesystemAdapter = createFilesystemAdapter({
  id: "filesystem-example",
  allowedRoots: [workspaceRoot],
  baseDir: workspaceRoot,
});

const refreshed = await runLocalFileSidecarCommand({
  mode: "execute_approved",
  sourcePath: "notes/stale.txt",
  filesystemAdapter,
  approval: { granted: true, approver: "user" },
});

console.log(refreshed.status); // "written"
console.log(refreshed.execution);
```

## Integration Warnings

- this API is explicit-file-only
- no folder ingestion is implied
- no media analysis is implied
- no source files are modified
- no external APIs are called
- callers must ask a human or user before executing approved writes

For the implementation handover packet, see
[docs/LOCAL_FILE_SIDECAR_HANDOVER.md](docs/LOCAL_FILE_SIDECAR_HANDOVER.md).
