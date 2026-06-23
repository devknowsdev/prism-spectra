---
Last-Updated: 2026-06-24
Status: Implementation planning baseline
Depends-On: docs/OPEN_SOURCE_HARVEST_AUDIT.md
---

# Harvest Implementation Plan

## Purpose

This document turns the open-source harvest audit into an implementation plan for Prism Spectra.

The goal is to harvest narrow libraries and proven patterns while keeping Prism's identity layer original:

- local-first event ledger;
- safe approval-before-write flow;
- visible diffs and rollback paths;
- command mirror between CLI and workbench;
- calm resume/changes/approvals UX;
- project memory through conversations, attachments, artifacts, checkpoints, and runs.

## Product constraint

Do not build a generic dashboard, chat app, autonomous agent shell, or full graph canvas.

Build the smallest usable **resumption spine** first:

1. What was I doing?
2. What changed?
3. What needs approval?
4. What is the next safe action?
5. What command would reproduce this?
6. What checkpoint/rollback path protects me?

## Dependency shortlist

Final dependency installation must wait for a lockfile/SBOM/licence check. This is the recommended shortlist.

| Need | Preferred candidate | Alternative | Decision posture |
|---|---|---|---|
| CLI command framework | `clipanion` | `commander` | Choose one in Sprint 1. |
| SQLite schema/query layer | `drizzle-orm` | `kysely` | Prefer Drizzle if migrations matter; Kysely if SQL-first control matters. |
| SQLite adapter | Existing repo DB layer or `better-sqlite3` | `sqlite`/other adapter | Reuse existing repo DB if already present; avoid native packaging surprises if possible. |
| Git wrapper | `simple-git` | direct child process wrapper | Use dependency behind `PrismGit`. |
| Diff parser | `jsdiff` | custom parser | Use dependency and pin modern version. |
| Diff UI | `@codemirror/merge` | Monaco diff editor | Prefer CodeMirror for calm review. |
| File repair | `jsonrepair`, `prettier` | custom repair | Wrap as preview-only until approved. |
| Attachment metadata | `file-type`, `mime-types` | custom sniffing | Use dependency. |
| Future map | `@xyflow/react` | Cytoscape.js | Do not start until ledger spine exists. |
| Tool interoperability | MCP TypeScript SDK | custom-only tools | Support MCP through Prism capability manifest. |

## Sprint sequence

### Sprint 1 — Event ledger and approval/diff spine

Build the foundation for every later UI feature.

Deliverables:

- CLI framework decision.
- Event ledger schema.
- Event append/query service.
- `PrismGit` service over local Git operations.
- Diff parser service.
- Approval-card data model.
- Command mirror metadata model.
- Resume snapshot projection.
- Changes timeline projection.
- Tests for the safety-critical pieces.

Do not build:

- React Flow map;
- parts-library UI;
- Tauri shell;
- plugin registry;
- autonomous execution;
- multi-agent crew/role abstractions.

### Sprint 2 — Calm workbench screens

Build the first calm visual workbench screens over the Sprint 1 data model.

Deliverables:

- Resume screen.
- Approvals screen.
- Changes screen.
- Diff preview drawer.
- Checkpoint/rollback preview UI.
- Command mirror display on every action.

### Sprint 3 — Attachments and conversations as project memory

Expose backend memory features as first-class UI.

Deliverables:

- Conversation list/detail.
- Message view/add flow.
- Attachment list/detail.
- Upload/download/tag/rename/move/delete UI.
- Attachment compare UI.
- Repair preview/apply UI.
- Links from conversations and attachments to runs/checkpoints/events.

### Sprint 4 — Focused project map MVP

Build a secondary comprehension view only after the event ledger can feed it.

Deliverables:

- Current task map.
- Changed-today map.
- Rollback-path map.
- Artifact lineage map.
- Node inspector with CLI/API equivalent.

### Sprint 5 — Parts library MVP

Build explicit reuse, not an automatic junk drawer.

Deliverables:

- `Part` and `PartUse` records.
- Manual promotion from successful run/repair/workflow.
- Trust/provenance fields.
- Search/filter by type, stack, source project, risk, and last used.
- One safe recipe: inspect -> preview diff -> approval -> write -> checkpoint.

## Sprint 1 module design

### 1. CLI command system

Goal: create the authoritative command grammar Prism's UI can mirror.

Candidate commands:

```bash
prism status
prism resume
prism changes today
prism approvals list
prism approvals show <approvalId>
prism approvals approve <approvalId>
prism approvals reject <approvalId>
prism diff --run <runId>
prism checkpoint create --label "before edit"
prism checkpoint list
prism rollback preview <checkpointId>
prism rollback apply <checkpointId>
prism attachments list
prism conversations list
prism map focus <entityId>
```

Implementation rule:

- The UI must be able to ask for command metadata.
- Every UI action should expose the equivalent CLI command.
- The CLI should be able to emit machine-readable JSON for workbench integration.

Suggested command metadata shape:

```ts
export interface PrismCommandDescriptor {
  id: string;
  title: string;
  description: string;
  cli: string;
  category: "resume" | "approval" | "change" | "checkpoint" | "attachment" | "conversation" | "provider" | "map" | "system";
  safetyClass: SafetyClass;
  requiresApproval: boolean;
  relatedEntityIds: string[];
}
```

### 2. Safety classes

Use four initial safety classes.

```ts
export type SafetyClass = "observe" | "stage" | "commit" | "destructive";
```

| Class | Meaning | Default behaviour |
|---|---|---|
| `observe` | Reads, lists, diffs, health checks | Auto-run. |
| `stage` | Builds plans, previews diffs, compares files, repair previews | Auto-run but visible. |
| `commit` | Writes, renames, moves, applies repairs, saves generated artifacts | Approval required. |
| `destructive` | Delete, rollback apply, broad shell execution, remote boundary crossing | High-salience approval required. |

### 3. Event ledger

The event ledger should start simple. Do not overbuild full event sourcing.

Required event categories:

```ts
export type PrismEventType =
  | "run.created"
  | "run.summary.updated"
  | "node.started"
  | "node.preview.ready"
  | "approval.requested"
  | "approval.resolved"
  | "artifact.modified"
  | "checkpoint.created"
  | "rollback.preview.ready"
  | "rollback.completed"
  | "provider.routed"
  | "boundary.crossed"
  | "cost.estimated"
  | "cost.actual"
  | "attachment.added"
  | "attachment.modified"
  | "conversation.updated"
  | "resume.snapshot.generated"
  | "command.executed";
```

Base event shape:

```ts
export interface PrismEvent {
  id: string;
  type: PrismEventType;
  occurredAt: string;
  projectId: string;
  taskId?: string;
  runId?: string;
  nodeId?: string;
  entityIds: string[];
  summary: string;
  severity: "info" | "success" | "warning" | "error";
  safetyClass: SafetyClass;
  payload: Record<string, unknown>;
}
```

Minimum tables:

- `events`
- `approvals`
- `checkpoints`
- `command_descriptors`
- `resume_snapshots`

Optional Sprint 1 tables if already easy:

- `artifacts`
- `attachments`
- `conversations`
- `messages`
- `provider_routes`
- `boundary_events`

### 4. Approval model

Approval cards are the safety UX primitive.

```ts
export interface ApprovalCard {
  id: string;
  projectId: string;
  taskId?: string;
  runId?: string;
  nodeId?: string;
  title: string;
  summary: string;
  safetyClass: "commit" | "destructive";
  status: "pending" | "approved" | "rejected" | "expired";
  affectedFiles: string[];
  affectedArtifacts: string[];
  provider?: string;
  boundary: "local" | "remote_no_training" | "remote_may_train" | "unknown";
  estimatedCost?: number;
  estimatedTimeMs?: number;
  diffRef?: string;
  checkpointBeforeRef?: string;
  rollbackCommand?: string;
  cliApproveCommand: string;
  cliRejectCommand: string;
  createdAt: string;
  resolvedAt?: string;
}
```

Approval card display requirements:

- plain-language summary;
- affected files/artifacts;
- local/remote boundary badge;
- estimated cost/time if available;
- diff/preview entry point;
- checkpoint/rollback path;
- exact CLI approve/reject commands.

### 5. Diff parser service

Wrap `jsdiff` behind a Prism-owned interface.

```ts
export interface PrismDiffFile {
  path: string;
  oldPath?: string;
  hunks: PrismDiffHunk[];
  summary: string;
  riskTags: string[];
}

export interface PrismDiffHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PrismDiffLine[];
  summary?: string;
}

export interface PrismDiffLine {
  kind: "context" | "add" | "remove";
  text: string;
}
```

Risk-tag examples:

- `deletes-file`
- `moves-file`
- `changes-config`
- `changes-package-json`
- `changes-lockfile`
- `changes-env`
- `changes-test`
- `changes-generated-artifact`
- `large-diff`

### 6. PrismGit service

Wrap local Git operations behind one auditable service.

Initial interface:

```ts
export interface PrismGit {
  status(workdir: string): Promise<GitStatus>;
  diff(workdir: string, opts?: DiffOptions): Promise<string>;
  checkpoint(workdir: string, label: string, metadata?: Record<string, unknown>): Promise<GitCheckpoint>;
  listCheckpoints(workdir: string, limit?: number): Promise<GitCheckpoint[]>;
  previewRollback(workdir: string, checkpointRef: string): Promise<RollbackPreview>;
  applyRollback(workdir: string, checkpointRef: string, approvalId: string): Promise<RollbackResult>;
}
```

Rules:

- `status`, `diff`, `listCheckpoints`, and `previewRollback` are observe/stage actions.
- `checkpoint` is commit class but may be allowed automatically before approved writes.
- `applyRollback` is destructive and always requires approval.
- Do not execute arbitrary Git aliases or untrusted repo scripts.

### 7. Resume snapshot generator

The first resume generator can be deterministic. It does not need an LLM.

Resume snapshot fields:

```ts
export interface ResumeSnapshot {
  id: string;
  projectId: string;
  generatedAt: string;
  lastActiveAt?: string;
  lastMeaningfulAction?: string;
  pendingApprovalCount: number;
  changedFileCount: number;
  recentCheckpointCount: number;
  nextSafeAction?: PrismCommandDescriptor;
  warnings: string[];
  relatedEventIds: string[];
}
```

Initial logic:

1. Find latest event for project.
2. Count pending approvals.
3. Count changed files/artifacts since last snapshot.
4. Find recent checkpoints.
5. Suggest next action:
   - pending approval exists -> `prism approvals list`;
   - unreviewed diff exists -> `prism diff --run <runId>`;
   - failed node exists -> inspect failed run;
   - clean but inactive -> resume last task;
   - no project activity -> status.

### 8. Changes timeline

Changes should show meaningful state changes, not raw logs.

Initial categories:

- runs;
- previews;
- approvals;
- file/artifact modifications;
- checkpoints;
- rollbacks;
- attachments;
- conversations;
- provider/boundary/cost events.

Timeline item shape:

```ts
export interface ChangeTimelineItem {
  id: string;
  projectId: string;
  occurredAt: string;
  title: string;
  summary: string;
  category: "run" | "approval" | "file" | "checkpoint" | "rollback" | "attachment" | "conversation" | "provider";
  severity: "info" | "success" | "warning" | "error";
  entityIds: string[];
  cliCommand?: string;
}
```

## Tests to add in Sprint 1

Minimum tests:

1. Safety classifier maps actions to correct class.
2. Event ledger appends and queries events in order.
3. Resume snapshot suggests approvals first when pending approvals exist.
4. Diff parser returns per-file hunks from a unified diff.
5. Diff parser flags `package.json`, `.env`, lockfiles, deletes, and large diffs.
6. Approval card contains affected files, boundary, CLI commands, and status.
7. Command descriptors render valid CLI strings.
8. `PrismGit.previewRollback` is available without applying changes.
9. `PrismGit.applyRollback` refuses to run without approval ID.
10. UI/action metadata never classifies destructive operations as observe/stage.

## File layout proposal

Adapt to the current repo structure after inspection. A likely layout:

```text
src/cli/
  commands.ts
  descriptors.ts
  index.ts

src/events/
  eventTypes.ts
  eventLedger.ts
  projections.ts
  resumeSnapshot.ts

src/safety/
  safetyClass.ts
  approvals.ts
  riskTags.ts

src/git/
  prismGit.ts
  checkpointTypes.ts

src/diff/
  parseDiff.ts
  diffTypes.ts

src/commands/
  commandMirror.ts

src/ui-contracts/
  approvalCard.ts
  changeTimeline.ts
  resumeSnapshot.ts
```

If existing modules already cover any of these domains, extend them rather than creating duplicate parallel systems.

## API additions for Sprint 1

Add only if not already present.

```http
GET /api/v1/resume
GET /api/v1/changes?projectId=...
GET /api/v1/approvals
GET /api/v1/approvals/:id
POST /api/v1/approvals/:id/approve
POST /api/v1/approvals/:id/reject
GET /api/v1/commands
GET /api/v1/commands/:id
```

These endpoints should return typed, stable UI contracts and should not expose raw internal logs as the primary surface.

## Codex-ready prompt: Sprint 1

```text
Implement Prism Spectra Harvest Sprint 1: event ledger and approval/diff spine.

Repository: devknowsdev/prism-spectra

Read first:
- README.md
- PROJECT_BRIEF.md
- docs/OPEN_SOURCE_HARVEST_AUDIT.md
- docs/HARVEST_IMPLEMENTATION_PLAN.md
- src/index.ts
- tools/daemon.ts
- existing memory, ledger, checkpoint, graph, and execution modules

Goal:
Build the smallest usable foundation for Prism's bidirectional CLI + calm visual workbench.

Do not build:
- a generic dashboard
- a chat app
- a full graph canvas
- a plugin marketplace
- autonomous destructive execution
- multi-agent role/crew abstractions

Implement:
1. CLI command descriptor model
   - every command has id, title, description, CLI string, category, safety class, requiresApproval
   - expose descriptors for status, resume, changes, approvals, diffs, checkpoints, rollback preview/apply

2. Safety classes
   - observe
   - stage
   - commit
   - destructive
   - add tests proving destructive actions are never classified as observe/stage

3. Event ledger
   - append-only local event model
   - event types for run, node preview, approval requested/resolved, artifact modified, checkpoint created, rollback preview/completed, provider/boundary/cost, resume snapshot, command executed
   - persist locally using the existing repo storage approach if present; otherwise add minimal SQLite-backed store

4. Approval-card model
   - plain-language summary
   - affected files/artifacts
   - provider and boundary
   - estimated cost/time if available
   - diffRef
   - checkpoint/rollback path
   - CLI approve/reject commands

5. Diff parser
   - wrap jsdiff or existing parser
   - parse unified diffs into per-file hunks
   - add risk tags for package/config/env/lockfile/deletion/large-diff

6. PrismGit wrapper
   - wrap git status, diff, checkpoint, list checkpoints, rollback preview, rollback apply
   - apply rollback requires approval ID
   - no untrusted repo script execution

7. Resume snapshot projection
   - deterministic first version
   - answer: what was I doing, what changed, what needs approval, next safe action

8. Changes timeline projection
   - meaningful grouped events, not raw logs

9. API endpoints if missing
   - GET /api/v1/resume
   - GET /api/v1/changes
   - GET /api/v1/approvals
   - POST /api/v1/approvals/:id/approve
   - POST /api/v1/approvals/:id/reject
   - GET /api/v1/commands

Tests:
- event append/query
- safety classification
- approval-card creation
- command descriptor validity
- diff parsing and risk tags
- resume snapshot prioritises pending approvals
- rollback apply refuses without approval ID

Constraints:
- prefer small explicit modules
- do not overbuild event sourcing
- do not add React Flow yet
- do not add Tauri yet
- do not add sync framework
- do not import heavy agent frameworks
- record any new dependencies and licence posture in docs

Expected output:
- code
- tests
- docs update noting dependency choices
- final report with test results

Suggested commit message:
feat: add event ledger and approval spine
```

## Codex-ready prompt: Dependency decision pass

```text
Perform a dependency decision pass for Prism Spectra Sprint 1.

Read:
- docs/OPEN_SOURCE_HARVEST_AUDIT.md
- docs/HARVEST_IMPLEMENTATION_PLAN.md
- package.json
- package-lock.json or pnpm/yarn lockfile if present

Goal:
Recommend exact dependency choices for:
- CLI framework: Clipanion vs Commander
- DB schema/query: Drizzle vs Kysely vs existing code
- SQLite adapter: existing code vs better-sqlite3 vs lighter alternative
- Git wrapper: simple-git vs existing child_process wrapper
- Diff parser: jsdiff vs existing code
- Diff UI: defer until workbench screen sprint

For each dependency:
- package name
- version recommendation
- licence
- runtime weight
- native build risk
- reason to adopt or reject
- tests required

Do not install anything until the recommendation is written.

Expected output:
- docs/DEPENDENCY_DECISION_RECORD.md
- no runtime code changes unless explicitly requested

Suggested commit message:
docs: record harvest dependency decisions
```

## Codex-ready prompt: Approval diff prototype

```text
Prototype Prism approval diff review.

Goal:
Build a minimal approval-card + diff-preview flow over existing proposed patches.

Read:
- docs/OPEN_SOURCE_HARVEST_AUDIT.md
- docs/HARVEST_IMPLEMENTATION_PLAN.md
- existing daemon preview-node endpoint
- existing checkpoint/rollback code

Implement:
- approval-card UI contract
- diff parser integration
- endpoint or local function to return approval card + parsed diff
- CLI command strings for approve/reject/open diff
- tests for risk tags and command strings

Constraints:
- do not create a full UI framework rewrite
- do not apply any patch automatically
- no destructive action without approval
- show checkpoint/rollback path where available

Suggested commit message:
feat: prototype approval diff review contracts
```

## Codex-ready prompt: Focused map experiment later

```text
Prototype a focused project map after the event ledger exists.

Do not run this before Sprint 1 is complete.

Goal:
Render a small React Flow map for one selected task/run, using ledger events as the data source.

Nodes:
- task
- run
- changed files
- checkpoint
- pending approval
- attachment
- next safe action

Edges:
- spawned
- changed
- checkpointed_as
- gates
- references
- next_action

Constraints:
- no arbitrary node creation
- no full-project graph
- no automatic layout that shows hundreds of nodes
- map must have presets: Current Focus, Changed Today, Rollback Path
- every node inspector shows CLI/API equivalent

Suggested commit message:
feat: add focused project map prototype
```

## Implementation guardrails

- Keep Prism local-first.
- Prefer explicit schemas over magic.
- Treat reads and previews differently from writes.
- Always show the rollback path before risky actions.
- Never bury local/remote boundary information.
- Avoid turning project memory into chat scroll.
- Avoid graph spaghetti.
- Avoid plugin sprawl.
- Add tests before expanding surfaces.

## Success criteria for Sprint 1

Sprint 1 is successful when:

- a user can run a CLI command to see resume status;
- pending approvals are represented as typed records;
- a proposed patch can be parsed into structured file/hunk data;
- an approval card can show affected files, safety class, diff ref, boundary, and CLI commands;
- Git checkpoint and rollback preview are available through a safe wrapper;
- destructive actions refuse to run without approval;
- tests prove the safety classifier, ledger, diff parser, command mirror, and resume projection work.
