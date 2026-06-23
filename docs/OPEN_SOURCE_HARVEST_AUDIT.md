---
Last-Updated: 2026-06-24
Status: Research baseline
Scope: Open-source harvest audit for Prism Spectra
---

# Open-Source Harvest Audit

## Purpose

This document records the open-source code and architecture harvest audit for Prism Spectra.

The goal is not to clone another agent product. The goal is to decide what Prism should:

- import as narrow dependencies;
- reimplement as proven patterns;
- keep as Prism-original identity layer;
- avoid because of licensing, weight, risk, or product mismatch.

Prism Spectra's current product direction is:

> **Bidirectional CLI + Calm Visual Workbench**

The CLI remains scriptable and authoritative. The visual workbench exists to reduce memory burden, show state, support interruption recovery, review diffs, manage approvals, show checkpoints, expose rollback paths, and later provide a focused project map and reusable parts library.

## Compatibility rubric

This audit assumes Prism wants to remain local-first, permissive-licence-friendly, and lightweight enough for constrained local hardware.

This is not legal advice. Before adding a dependency, run a package-level licence/SBOM check against the exact version in the lockfile.

General policy:

| Licence family | Dependency use | Source copying | Reimplement idea | Notes |
|---|---:|---:|---:|---|
| MIT / ISC / BSD | Usually safe | Usually safe with notices | Safe | Preserve copyright and licence notices. |
| Apache-2.0 | Usually safe | Usually safe with notices | Safe | Preserve notices; mark modified files if copying/adapting source. |
| MPL-2.0 | Possible with care | File-level copyleft | Safe | Avoid mixing source files into Prism unless the file-level obligations are intentional. |
| LGPL | Possible with care | Risky in bundled apps | Safe | Requires care around linking/distribution. |
| GPL | Avoid direct inclusion | Avoid unless Prism adopts compatible licence | Safe | Use only as reference unless a compatible licensing decision is made. |
| AGPL | Avoid direct inclusion | Avoid | Safe | Network copyleft risk; do not embed in daemon/server surfaces. |
| SSPL / non-commercial / custom source-available | Avoid | Avoid | Maybe | Treat as high-risk until reviewed. |
| Unknown/no licence | Avoid | Avoid | Maybe | No licence means no permission to reuse. |

## Executive verdict

Prism should **build its identity layer itself** and import only boring, narrow plumbing libraries.

The Prism-owned layer is:

- event ledger;
- approval semantics;
- safety classifier;
- checkpoint and rollback discipline;
- project memory schema;
- conversation, attachment, and artifact provenance;
- local/remote boundary language;
- command mirror grammar;
- calm resume/changes/approvals UX;
- focused project-map filtering rules;
- reusable parts-library trust model.

The best direct dependency candidates are:

- `clipanion` or `commander` for CLI command structure;
- `drizzle-orm` or `kysely` for typed SQLite access;
- `better-sqlite3` or an equivalent SQLite adapter for local storage;
- `simple-git` for local Git operations;
- `jsdiff` for patch/hunk parsing;
- `@codemirror/merge` for compact diff review;
- `@xyflow/react` for later focused project maps;
- `jsonrepair`, `prettier`, `file-type`, and `mime-types` for attachment and repair workflows;
- `@modelcontextprotocol/typescript-sdk` for MCP interoperability, wrapped by Prism's own safety metadata.

The best patterns to reimplement come from:

- Aider: repo-map generation, context pruning, git undo/diff habits, repair loops;
- Goose: permission modes, recipes, local CLI/server/desktop separation;
- LangGraph: interrupts, checkpointing, durable/resumable execution;
- Pydantic AI: typed outputs, tool manifests, validation, approval-aware streaming;
- Continue: read/write permission split, codebase indexing, provider abstraction;
- OpenHands: frontend/backend/runtime separation, sandbox messaging, event streaming.

The clearest avoid zones are:

- direct harvest from GPL/AGPL systems unless Prism deliberately adopts a compatible licence;
- ComfyUI-style open-ended graph editors as the primary UX;
- heavy cloud-first agent shells;
- enterprise orchestration frameworks as foundations;
- autonomous destructive execution;
- plugin marketplaces before Prism has a strict capability manifest and trust model.

## Repository harvest matrix

| Candidate | Category | Licence posture | Reuse mode | Prism use | Risk | Priority |
|---|---|---|---|---|---|---|
| Aider | AI coding CLI | Apache-2.0 | Reimplement pattern | Repo map, git undo/diff habits, lint/test repair loop, config layering | Python coupling; do not inherit command-execution risk | P0 |
| Goose | Local agent CLI/desktop/API | Apache-2.0 | Reimplement pattern | Permission modes, recipes, CLI/server/desktop split, MCP extension posture | Rust/TS stack shift; extension sprawl | P1 |
| OpenHands | Agent runtime/workbench | OSS with enterprise surfaces | Reference / reimplement pattern | Runtime separation, sandbox warnings, event streaming, resumable conversations | Heavy product surface; cloud/enterprise gravity | P1 |
| Continue | IDE/CLI/TUI assistant | Apache-2.0 | Reimplement pattern | Tool permissions, codebase indexing, provider abstraction, TUI hints | IDE coupling | P1 |
| SWE-agent / mini-swe-agent | Repo task runner | MIT | Reference | Minimal execution harness ideas, trajectories, tool bundles | Autonomy bias; benchmark orientation | P1 |
| LangGraph | Durable orchestration | MIT | Reimplement pattern | Interrupts, checkpointing, thread/resume model, state streaming | Framework gravity; Python-first | P0 |
| Pydantic AI | Typed agent framework | MIT | Reimplement pattern | Typed payloads, toolsets, validation, approval-aware streaming | Python-first; optional extras | P0 |
| CrewAI | Multi-agent flows | MIT | Reference / avoid as foundation | Flow primitives and human gates | Role/crew theatre; high cognitive overhead | P2 |
| AutoGen / AutoGen Studio | Multi-agent framework/studio | MIT for code | Reference | Message-flow visualisation, gallery ideas | Research/studio complexity | P2 |
| Semantic Kernel / Agent Framework | Enterprise agent frameworks | MIT | Reference | Plugin abstractions, middleware concepts | Enterprise/cloud heaviness | P2 |
| Textual | TUI framework | MIT | Pattern / optional sidecar | Calm TUI reference, command palette, tree/code panes | Python stack shift | P1 |
| Bubble Tea | TUI framework | MIT | Pattern | Predictable TUI state model | Go stack shift | P2 |
| Ink | TUI framework | MIT | Optional dependency | TypeScript-native focused terminal UI | TUI complexity and ecosystem variability | P1 |
| Clipanion | CLI framework | MIT | Direct dependency | Typed nested command model for authoritative CLI | Less familiar than Commander | P0 |
| Commander.js | CLI framework | MIT | Direct dependency | Familiar command parser/help system | Less structured for deep command mirror | P0 |
| React Flow / xyflow | Graph UI | MIT | Direct dependency later | Focused project map and run graph | Graph-spaghetti risk | P0 |
| Mermaid | Diagram export | MIT | Direct dependency later | Static graph/workflow snapshots | Not interactive enough for workbench | P1 |
| Cytoscape.js | Graph analysis/visualisation | MIT | Optional specialist dependency | Dense dependency/neighbourhood maps later | Heavier model than React Flow | P2 |
| ComfyUI frontend | Node graph workbench | Must verify exact frontend licence; manager is GPL-3.0 | Reference only | Workflow persistence and reusable node ideas | Node-spaghetti culture; GPL-adjacent ecosystem | P2 |
| Sourcetrail | Code graph explorer | GPL-3.0 | Reference only | Code-neighbourhood inspiration | GPL and historical project status | P3 |
| simple-git | Git wrapper | Permissive | Direct dependency | Checkpoints, status, diff, rollback metadata | Requires installed Git; wrap carefully | P0 |
| isomorphic-git | JS Git implementation | Verify before use | Reference only | Browser-only Git fallback if ever needed | Auth/CORS/push edge cases; not authoritative local Git | P2 |
| CodeMirror Merge | Diff UI | Permissive CodeMirror family | Direct dependency | Diff review and approval preview | Verify exact package licence | P0 |
| Monaco diff editor | Editor/diff UI | MIT | Optional dependency | Full IDE-grade editing/diffing | Heavier than needed | P1 |
| jsdiff | Diff/patch parsing | Permissive | Direct dependency | Unified diff parsing, hunks, patch summaries | Pin modern version; test pathological inputs | P0 |
| GitButler / Lazygit | Git UX references | Permissive / MIT | Reimplement pattern | Checkpoint browsing, stacked changes, keyboard git UX | Do not become a full git client | P1 |
| better-sqlite3 | SQLite adapter | MIT in practice; verify | Direct dependency | Local event ledger storage | Native build/distribution risk | P1 |
| Drizzle ORM | Typed DB schema | Apache-2.0 | Direct dependency | Explicit SQLite schemas and migrations | Verify adjacent package licences in lockfile | P0 |
| Kysely | SQL query builder | MIT | Direct dependency | SQL-first typed access | More manual migrations than Drizzle | P1 |
| Prisma ORM | Full ORM | Apache-2.0 | Avoid phase one | Rich DB tooling | Runtime/binary/client-generation weight | P2 |
| ElectricSQL / RxDB / Replicache / Yjs / Automerge | Local-first sync | Mixed | Reference later | Multi-device sync ideas | Too heavy before local-only ledger is proven | P2 |
| jsonrepair | JSON repair | MIT-style | Direct dependency | Safe JSON repair with diff/provenance | Must never overwrite without approval | P0 |
| Prettier | Formatting | MIT | Direct dependency | Repair/normalisation preview | Large language surface; wrap narrowly | P0 |
| file-type | File type detection | MIT | Direct dependency | Attachment metadata | ESM and binary sniffing behaviour to test | P0 |
| mime-types | MIME lookup | MIT | Direct dependency | Attachment metadata | Low | P0 |
| MCP TypeScript SDK | Tool protocol | Verify exact package licence | Dependency behind Prism wrapper | Tool/resource/prompt interoperability | Evolving SDK; Prism needs stricter risk manifest | P0 |
| Node-RED / Home Assistant / Obsidian plugin model | Plugin ecosystems | Mixed permissive references | Reimplement pattern | Curated capabilities and integrations | Too broad to embed | P1 |

## P0 harvest cards

### React Flow / xyflow

- **Target Prism feature:** Focused project map and graph execution view.
- **Reuse mode:** Direct dependency, later in the map sprint.
- **Why useful:** Provides custom nodes, edges, viewport controls, keyboard affordances, and enough graph UI machinery to avoid building a canvas from scratch.
- **Prism constraint:** Use it for filtered neighbourhood maps, not an open-ended node editor.
- **First experiment:** Render a current-task neighbourhood with nodes for task, changed files, checkpoint, pending approval, attachment, and next safe action.
- **Do not:** Make the graph the home screen or allow arbitrary graph editing in MVP.

### CodeMirror Merge

- **Target Prism feature:** Approval diff UI.
- **Reuse mode:** Direct dependency.
- **Why useful:** Lightweight review surface for proposed AI edits and repair previews.
- **Prism constraint:** Default to calm, compact diff summaries with drill-down to side-by-side when needed.
- **First experiment:** Proposed edits drawer with file-level and hunk-level accept/reject controls.

### simple-git

- **Target Prism feature:** Git checkpoints, status, diff, rollback metadata.
- **Reuse mode:** Direct dependency behind a `PrismGit` service.
- **Why useful:** Lets the user's system Git remain authoritative.
- **Prism constraint:** No destructive Git operations without approval. Shell arguments must be controlled and auditable.
- **First experiment:** Implement `checkpoint.create`, `checkpoint.list`, `diff.workingTree`, and `rollback.preview` wrappers.

### jsdiff

- **Target Prism feature:** Unified diff parsing and hunk metadata.
- **Reuse mode:** Direct dependency.
- **Why useful:** Converts model-generated or tool-generated patches into structured Prism hunk objects.
- **Prism constraint:** Pin a modern version and test malicious/pathological diffs.
- **First experiment:** Parse unified diffs into `{ filePath, hunks, summary, riskTags }`.

### Drizzle ORM or Kysely

- **Target Prism feature:** Local event ledger and project-memory tables.
- **Reuse mode:** Direct dependency.
- **Why useful:** Typed schemas without adopting a heavyweight ORM.
- **Prism constraint:** Keep schema explicit and migration history readable.
- **First experiment:** Add append-only `events` plus read tables for approvals, checkpoints, attachments, conversations, and command metadata.

### MCP TypeScript SDK

- **Target Prism feature:** External tool interoperability.
- **Reuse mode:** Direct dependency behind a Prism capability wrapper.
- **Why useful:** Standard tool/resource/prompt protocol.
- **Prism constraint:** MCP metadata is not enough. Prism must add approval class, risk, reversibility, cost, boundary, and provenance fields before activating a capability.
- **First experiment:** Import one MCP tool into a Prism capability record and require explicit activation.

### Aider patterns

- **Target Prism feature:** Repo map and git-first edit discipline.
- **Reuse mode:** Reimplement pattern.
- **Why useful:** Aider proves that codebase maps, selective context, `/diff`, and `/undo` are powerful for terminal-first AI coding.
- **Prism constraint:** Build a TypeScript-native, UI-aware project neighbourhood index rather than copying Aider's Python internals.
- **First experiment:** Cached file/symbol/change index used by both CLI and workbench.

### LangGraph patterns

- **Target Prism feature:** Durable execution, interrupts, resume after approval.
- **Reuse mode:** Reimplement pattern.
- **Why useful:** Clear conceptual model for graph state, checkpointing, and human-in-loop pauses.
- **Prism constraint:** Use JSON-safe serialization and Prism-owned approval semantics.
- **First experiment:** Add `interrupt_before_write`, `approval.requested`, and `resume_after_approval` event flow.

### Pydantic AI patterns

- **Target Prism feature:** Typed model/tool payloads.
- **Reuse mode:** Reimplement pattern.
- **Why useful:** Strong design reference for validation, typed outputs, toolsets, and approval-aware streaming.
- **Prism constraint:** Implement in Prism's TypeScript schema stack rather than importing Python framework code.
- **First experiment:** Define typed schemas for approval cards, tool manifests, and command mirror metadata.

### Goose patterns

- **Target Prism feature:** Permissions and future recipes/parts library.
- **Reuse mode:** Reimplement pattern.
- **Why useful:** Good reference for local CLI/server/desktop split, tool permission modes, and reusable recipes.
- **Prism constraint:** Prism recipes must include risk, reversibility, boundary, cost, and provenance fields from day one.
- **First experiment:** Implement one `PartRecipe` manifest: inspect -> preview diff -> approval -> write -> checkpoint.

## Prism module mapping

| Prism module | Needed capability | Existing Prism direction | Candidate source | Reuse mode | Priority |
|---|---|---|---|---|---|
| CLI command system | Nested, scriptable commands with help and completion | CLI is authoritative | Clipanion / Commander | Dependency | P0 |
| Command mirror metadata | UI action maps to exact CLI command | Needed for bidirectional workbench | Prism-owned schema, inspired by Textual/OpenHands palettes | Build | P0 |
| Daemon API client | Typed local API calls | Existing daemon endpoints | Prism-owned | Build | P0 |
| Event ledger | Append-only project memory | Needed for resume/changes/map | Drizzle/Kysely + SQLite | Dependency + build | P0 |
| Approval queue | Pending write/destructive/boundary actions | Core safety surface | LangGraph/Continue/Goose patterns | Build | P0 |
| Safety classifier | Observe/stage/commit/destructive classes | Core trust model | Goose/Continue patterns | Build | P0 |
| Diff preview | Parse and render proposed changes | Approval UI | jsdiff + CodeMirror Merge | Dependency | P0 |
| Checkpoint/rollback UI | Git status, checkpoint list, rollback preview | Existing daemon concept | simple-git + Lazygit/GitButler patterns | Dependency + pattern | P0 |
| Resume snapshot generator | What was I doing / what changed / next safe action | Core neurodivergent UX | Prism-owned | Build | P0 |
| Changes timeline | Meaningful events grouped by time/project | Needed before map | Event ledger + Prism projections | Build | P0 |
| Attachment manager UI | Upload/download/tag/rename/delete/compare/repair | Existing daemon gap in UI | file-type, mime-types, jsonrepair, Prettier | Dependency + build | P1 |
| Conversation/artifact memory UI | Messages and attachments tied to work | Existing daemon gap in UI | Prism-owned | Build | P1 |
| Provider/budget/boundary UI | Show cost and local/remote risk | Existing direction | Prism-owned | Build | P1 |
| Focused project map | Current task/change/checkpoint/artifact map | Later feature | React Flow | Dependency | P1 |
| Parts/tools library | Curated reusable parts with provenance | Later feature | Goose recipes, Node-RED/Home Assistant patterns | Build | P1 |
| TUI calm mode | Focused terminal review and approvals | Fallback/secondary | Ink or Textual inspiration | Optional dependency/pattern | P2 |
| Tauri shell | Native wrapper | Later | Tauri docs, current web app | Build later | P2 |
| Plugin/capability schema | Tools with risk/boundary metadata | Needed before extension sprawl | MCP SDK + Prism manifest | Dependency + build | P1 |
| Test harness | Verify safety, diffs, events, commands | Needed for trust | SWE-agent/mini-swe-agent references | Build | P0 |

## Borrow / reimplement / build / avoid

### Borrow directly as dependencies

- CLI framework: `clipanion` or `commander`.
- Local DB: `drizzle-orm` or `kysely`, plus a SQLite adapter.
- Git wrapper: `simple-git`.
- Diff parsing: `jsdiff`.
- Diff UI: `@codemirror/merge`.
- Focused map: `@xyflow/react`.
- Repair utilities: `jsonrepair`, `prettier`.
- Attachment metadata: `file-type`, `mime-types`.
- Tool interoperability: MCP TypeScript SDK, wrapped by Prism capability metadata.

### Reimplement patterns

- Aider repo map and git-first undo/diff habits.
- LangGraph interrupts and checkpoint/resume semantics.
- Goose permission modes and recipes.
- Pydantic AI typed output/toolset validation.
- Continue read/write permission split.
- OpenHands runtime separation and sandbox warnings.
- GitButler/Lazygit checkpoint/history ergonomics.
- Obsidian-style local graph filtering.

### Build ourselves

- Event ledger semantics.
- Approval-card schema.
- Safety classes.
- Resume snapshot generator.
- Command mirror metadata.
- Project-memory model.
- Conversation/artifact/attachment provenance.
- Local/remote boundary and cost language.
- Focused map filtering rules.
- Parts-library trust/provenance model.

### Avoid

- Full-canvas node editor as primary UX.
- Direct harvest from GPL/AGPL ecosystems.
- ComfyUI-Manager code.
- Sourcetrail code.
- CrewAI/AutoGen-style role-play as core architecture.
- OpenHands as a foundation.
- Semantic Kernel / Microsoft Agent Framework as a foundation.
- Prisma ORM in phase one.
- Multi-device sync frameworks before local ledger is proven.
- Any tool path that executes untrusted repo scripts by default.

## Immediate P0 harvest targets

1. Choose CLI framework: Clipanion if typed command architecture matters most; Commander if familiarity matters most.
2. Add SQLite event ledger schema with Drizzle or Kysely.
3. Wrap Git operations through `PrismGit` over `simple-git`.
4. Add patch parser over `jsdiff`.
5. Add approval-card data model.
6. Add CodeMirror Merge proof-of-concept for diff preview.
7. Define Prism capability manifest and MCP import boundary.
8. Reimplement Aider-style project neighbourhood index in TypeScript.
9. Reimplement LangGraph-style interrupt-before-write flow.
10. Add tests around safety classification, command mirror output, diff parsing, and ledger append operations.

## Do not harvest yet

- React Flow for the full project map until the event ledger and approval spine exist.
- Parts-library UI until promotion/provenance rules are implemented.
- Tauri shell until web workbench flow is proven.
- Sync frameworks until single-device local state is stable.
- Plugin marketplace or extension registry until Prism capability manifests are strict.

## Open questions

- Final Prism outbound licence.
- Exact DB adapter choice and native-build packaging posture.
- Whether CLI framework should prioritise TypeScript structure or broad contributor familiarity.
- Whether diff UI should use CodeMirror Merge only or eventually support Monaco for richer editing.
- Exact MCP SDK licence and version after lockfile/SBOM validation.
- Whether TUI calm mode should be TypeScript-native with Ink or a separate Python Textual app.
