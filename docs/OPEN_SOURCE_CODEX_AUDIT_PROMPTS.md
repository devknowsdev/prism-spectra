# Open-Source Codex Audit Prompts

## Purpose

This document turns the open-source harvest research into concrete Codex-ready source audits.

The goal is not to copy whole products into Prism Spectra. The goal is to identify source-level patterns, small library candidates, architecture lessons, safety mechanisms, and implementation approaches that Prism can harvest without losing its local-first, safe, low-cognitive-load identity.

Use these prompts one repo or topic at a time. Each audit should produce evidence-backed findings with concrete file paths, module names, license notes, and a clear recommendation:

- **import as dependency**
- **vendor/fork tiny module**
- **reimplement pattern**
- **reference only**
- **avoid**

## Shared Codex Rules

Apply these rules to every audit.

1. Use repository source evidence only.
2. Inspect README, license, package metadata, source tree, and relevant implementation files.
3. Cite exact files and paths in the result.
4. Do not infer design intent without source evidence.
5. If source access fails, reduce scope and retry a smaller fetch.
6. Do not recommend direct code copying without license and coupling analysis.
7. Treat GPL, AGPL, source-available, premium-plugin, or unclear-license areas conservatively.
8. Identify whether the result is useful for Prism's current product direction:
   - bidirectional CLI + calm visual workbench
   - explicit approval before writes/destructive actions
   - visible diffs/checkpoints/rollback
   - conversations, attachments, and artifacts as project memory
   - later focused project map
   - later curated parts/tools library
9. Prefer small, boring dependencies over large product-framework adoption.
10. End every audit with a practical Prism implementation recommendation.

## Shared Output Template

Every Codex audit should use this structure:

```markdown
# Source Audit: <repo/topic>

## Verdict
- Recommendation:
- Reuse mode:
- Fit score: /5
- Priority: P0/P1/P2/P3

## Repo facts
- Repository:
- License:
- Primary language:
- Package/runtime assumptions:
- Maintenance signal:
- Local-first friendliness:

## Files inspected
| Path | Why inspected | Finding |
|---|---|---|

## Relevant architecture
Describe the source-backed architecture relevant to Prism.

## Harvest candidates
| Candidate | Source path | Use in Prism | Reuse mode | Risk |
|---|---|---|---|---|

## Safety / approval / boundary lessons
Explain anything relevant to explicit approvals, filesystem risk, local/remote boundaries, sandboxing, undo, checkpoints, destructive actions, or command execution.

## License and dependency notes
State whether the code is safe to depend on, safe to copy with notices, risky, or reference-only.

## What Prism should borrow
Concrete patterns or modules.

## What Prism should avoid
Concrete anti-patterns or unsafe/overheavy areas.

## First experiment
Smallest Prism prototype to validate the harvest.

## Codex implementation follow-up
A focused prompt to implement the first experiment inside Prism.
```

---

# Prompt 1 — Aider repo-map, git undo, and repair-loop audit

```text
Audit Aider for Prism Spectra source-harvest value.

Repository:
- https://github.com/Aider-AI/aider

Prism context:
Prism needs a local-first, safe, scriptable repo/workbench system. We want to learn from Aider's terminal-first UX, repo map, git habits, diff/undo flow, lint/test repair loop, and config layering. We do not want to vendor Aider wholesale.

Inspect at minimum:
- README and docs relevant to repo maps, git, commands, lint/test, configuration
- LICENSE and package metadata
- `aider/repomap.py`
- `aider/repo.py`
- `aider/commands.py`
- `aider/args.py`
- `aider/main.py`
- `aider/linter.py`
- tests covering repo map, git, commands, lint/test repair

Answer:
1. How does Aider generate and prune repo context?
2. What data structures does its repo map use?
3. How does it decide which files/symbols matter?
4. How does it integrate git status, diffs, auto-commits, and undo?
5. How are commands parsed and surfaced to the user?
6. How does the lint/test repair loop work?
7. Which ideas should Prism reimplement in TypeScript?
8. Which code should Prism avoid copying?
9. What security risks does Prism need to avoid, especially around repository commands or startup scripts?
10. What is the smallest Prism experiment inspired by Aider?

Expected Prism recommendation:
- Reimplement repo-map and git-undo patterns.
- Do not vendor Aider core.
- Produce a TypeScript-oriented design for a Prism repo-neighbourhood index.
```

---

# Prompt 2 — Goose permissions, recipes, CLI/server/desktop split audit

```text
Audit Goose for Prism Spectra source-harvest value.

Repository:
- https://github.com/block/goose

Prism context:
Prism needs explicit approval gates, local/remote boundary visibility, a future parts/tools library, and possibly CLI + server + workbench separation. Goose is relevant for permission modes, MCP/tool integrations, recipes, and multi-surface architecture.

Inspect at minimum:
- README and docs for CLI, desktop, API/server, extensions, permissions, recipes, MCP
- LICENSE and package metadata
- CLI entrypoint modules
- server/API entrypoint modules
- core agent/tool permission modules
- recipe-related modules and schemas
- desktop UI modules that expose permissions or run state
- tests around permissions/tools if present

Answer:
1. What are Goose's execution surfaces: CLI, desktop, API/server?
2. How are permission modes represented?
3. How are tools/extensions declared and enabled?
4. What is the recipe format and lifecycle?
5. How does Goose handle local vs remote providers or external services?
6. What approval or safety patterns should Prism borrow?
7. What extension-overload or directory-boundary risks should Prism avoid?
8. Are any schemas or ideas suitable for Prism's parts library?
9. What source files are most useful for a follow-up implementation pass?
10. What is the smallest Prism experiment inspired by Goose?

Expected Prism recommendation:
- Reimplement simplified permission and recipe/parts patterns.
- Do not adopt Goose runtime as a dependency.
- Create a Prism capability manifest with risk, approval, reversibility, cost, boundary, and provenance metadata.
```

---

# Prompt 3 — OpenHands runtime, sandbox, event stream, and change-review audit

```text
Audit OpenHands for Prism Spectra source-harvest value.

Repository:
- https://github.com/All-Hands-AI/OpenHands

Prism context:
Prism needs a local daemon/workbench split, visible execution state, safe filesystem writes, checkpoint/rollback visibility, and long-running task resumption. OpenHands is relevant as a reference for frontend/backend/runtime separation, sandbox warnings, event streaming, and conversation resumption.

Inspect at minimum:
- README and docs for architecture, runtime, sandboxing, CLI, web UI, headless mode, event logs
- LICENSE and any enterprise/source-available subtrees
- backend/app server entrypoints
- runtime/sandbox modules
- event/log streaming modules
- frontend modules for changes, conversations, status, or run logs
- approval/confirmation/auto-approve paths
- tests around runtime/event streaming if present

Answer:
1. How is the frontend/backend/runtime split implemented?
2. How are filesystem and sandbox boundaries communicated?
3. How are events/logs represented and streamed?
4. How does conversation resumption work?
5. How are changes displayed to the user?
6. Where does auto-approval exist, and why should Prism avoid it as a default?
7. Which runtime separation patterns should Prism borrow?
8. Which cloud/enterprise/heavy areas should Prism avoid?
9. What license boundaries matter?
10. What is the smallest Prism experiment inspired by OpenHands?

Expected Prism recommendation:
- Reference OpenHands for runtime/event architecture and sandbox language.
- Do not adopt OpenHands as a foundation.
- Build Prism's own smaller event stream and approval-before-write model.
```

---

# Prompt 4 — Continue CLI/TUI, indexing, context providers, and tool permissions audit

```text
Audit Continue for Prism Spectra source-harvest value.

Repository:
- https://github.com/continuedev/continue

Prism context:
Prism needs a CLI command model, possible TUI calm mode, context/indexing patterns, tool permissions, provider abstraction, and edit/diff review ideas. Continue is relevant but likely too IDE-specific to adopt wholesale.

Inspect at minimum:
- README and docs for CLI, TUI, IDE extension, tools, permissions, model/provider config, indexing
- LICENSE and package metadata
- CLI command modules
- TUI modules if present
- codebase indexing modules
- context provider modules
- tool permission modules
- edit/diff application modules
- provider/model abstraction modules

Answer:
1. How is Continue structured across IDE, CLI, and TUI surfaces?
2. How are commands defined?
3. How is codebase context indexed and retrieved?
4. How are context providers declared and invoked?
5. How are tool permissions represented?
6. What edit/diff review patterns are useful for Prism?
7. What is too IDE-specific to reuse?
8. Which modules are worth deeper source inspection?
9. What is the smallest Prism experiment inspired by Continue?

Expected Prism recommendation:
- Borrow context provider and permission concepts.
- Do not make Prism dependent on an IDE extension architecture.
- Use lessons for Prism's command mirror and context retrieval.
```

---

# Prompt 5 — LangGraph durable execution, checkpoint, interrupt, and resume audit

```text
Audit LangGraph for Prism Spectra source-harvest value.

Repository:
- https://github.com/langchain-ai/langgraph

Prism context:
Prism needs durable execution, checkpoints, human-in-the-loop interrupts, resumable runs, and safe pause-before-write behavior. LangGraph is a pattern source, not necessarily a dependency.

Inspect at minimum:
- README and docs for persistence, checkpoints, interrupts, streaming, human-in-the-loop, memory
- LICENSE and package metadata
- checkpointer implementations, especially SQLite or lightweight savers
- interrupt/resume types
- graph execution loop modules
- event/streaming modules
- tests around interrupts and checkpoint resume

Answer:
1. How does LangGraph represent execution state?
2. How do checkpoints work?
3. How are interrupts emitted and resumed?
4. How are thread IDs or run IDs used as resumable cursors?
5. What storage/serialization assumptions create security risks?
6. What should Prism copy conceptually?
7. What should Prism avoid because it is framework-heavy or Python-specific?
8. What would a TypeScript Prism interrupt/checkpoint design look like?
9. What is the smallest Prism experiment inspired by LangGraph?

Expected Prism recommendation:
- Reimplement the ideas: run thread, interrupt, approval request, checkpoint, resume command.
- Store JSON-safe payloads only.
- Keep Prism's filesystem and approval semantics original.
```

---

# Prompt 6 — Pydantic AI typed outputs, toolsets, approvals, and observability audit

```text
Audit Pydantic AI for Prism Spectra source-harvest value.

Repository:
- https://github.com/pydantic/pydantic-ai

Prism context:
Prism needs typed event payloads, tool/capability schemas, provider abstraction, approval-aware tool calls, structured outputs, validation, and cost/observability hooks.

Inspect at minimum:
- README and docs for agents, tools, toolsets, approvals, durable execution, providers, observability, evals
- LICENSE and package metadata
- agent graph modules
- toolset modules
- approval/streaming modules
- provider/model abstraction modules
- schema/output validation modules

Answer:
1. How are tools and toolsets declared?
2. How are structured outputs validated?
3. How are model/provider abstractions represented?
4. How do approval-aware or deferred tool calls work?
5. What observability/cost patterns are worth copying conceptually?
6. What payload/schema ideas should Prism adapt?
7. What is too Python/Pydantic-specific?
8. What is the smallest Prism experiment inspired by Pydantic AI?

Expected Prism recommendation:
- Reimplement typed schemas and capability manifests in TypeScript.
- Borrow payload shape ideas.
- Do not adopt Pydantic AI as Prism's runtime.
```

---

# Prompt 7 — React Flow focused project-map source audit

```text
Audit React Flow / xyflow for Prism Spectra source-harvest value.

Repository:
- https://github.com/xyflow/xyflow

Prism context:
Prism may later build a focused live project map. It should not become a full node-editor-first product. The map should show a small neighbourhood around current task, files, checkpoints, conversations, attachments, tools, and next safe actions.

Inspect at minimum:
- README and docs for React Flow
- license and package metadata
- examples for custom nodes, controls, minimap, keyboard navigation, accessibility, selection, viewport, undo/redo, copy/paste
- state management recommendations
- performance guidance for large graphs

Answer:
1. What React Flow APIs best fit Prism's focused map?
2. How should Prism model nodes and edges?
3. What examples are most useful for a small MVP?
4. How can Prism support keyboard navigation and accessibility?
5. What graph sizes or interactions should Prism avoid?
6. How can Prism prevent map spaghetti?
7. What is the smallest project-map experiment?

Expected Prism recommendation:
- Use React Flow as a dependency for the later focused map.
- Keep arbitrary node creation disabled.
- Build map presets: Current Focus, Changed Today, Rollback Path, Reused Parts.
```

---

# Prompt 8 — CodeMirror Merge and jsdiff approval-diff audit

```text
Audit CodeMirror Merge and jsdiff for Prism Spectra source-harvest value.

Repositories:
- https://github.com/codemirror/merge
- https://github.com/kpdecker/jsdiff

Prism context:
Prism needs approval cards with compact diff previews before file writes, repair applies, node execution, or rollback. It needs patch parsing and a calm diff UI.

Inspect at minimum:
- license and package metadata for both packages
- CodeMirror Merge examples/docs
- jsdiff patch parsing APIs and known edge cases
- tests or examples for unified diffs, hunks, and large/odd inputs
- accessibility/keyboard considerations for CodeMirror diff views

Answer:
1. Which package should parse patches?
2. Which component should render review UI?
3. How should Prism represent file diffs and hunks internally?
4. Can Prism support file-level and hunk-level approvals?
5. What performance/security edge cases matter?
6. What is the smallest approval-diff experiment?

Expected Prism recommendation:
- Use jsdiff for patch/hunk parsing.
- Use CodeMirror Merge for lightweight review UI.
- Build Prism's own approval-card schema around them.
```

---

# Prompt 9 — simple-git and git UX references audit

```text
Audit simple-git and selected git UX references for Prism Spectra source-harvest value.

Repositories:
- https://github.com/steveukx/git-js
- https://github.com/gitbutlerapp/gitbutler
- https://github.com/jesseduffield/lazygit

Prism context:
Prism needs git-backed checkpoints, status, diff, rollback preview, rollback apply, and a low-anxiety history/checkpoint UI. Git should remain the authoritative local version-control layer.

Inspect at minimum:
- simple-git README, license, package metadata, typings, response types
- GitButler UI/docs/source areas relevant to virtual branches, stacked changes, file review, commit grouping
- Lazygit UI/docs/source areas relevant to keyboard-driven history, staging, diff, revert flows

Answer:
1. Is simple-git adequate for Prism's daemon-side git operations?
2. What wrapper API should Prism define over simple-git?
3. What git operations need explicit approval?
4. What checkpoint metadata should Prism store?
5. What UI patterns should Prism borrow from GitButler/Lazygit?
6. What would make Prism accidentally become a full git client, and how do we avoid that?
7. What is the smallest checkpoint/rollback experiment?

Expected Prism recommendation:
- Use simple-git as a dependency.
- Reimplement narrow checkpoint/rollback UX patterns.
- Do not make Prism a general git client.
```

---

# Prompt 10 — Drizzle/Kysely/better-sqlite3 event-ledger audit

```text
Audit Drizzle ORM, Kysely, and better-sqlite3 for Prism Spectra source-harvest value.

Repositories:
- https://github.com/drizzle-team/drizzle-orm
- https://github.com/kysely-org/kysely
- https://github.com/WiseLibs/better-sqlite3

Prism context:
Prism needs a small local event ledger and project-memory database for runs, approvals, checkpoints, conversations, messages, attachments, artifacts, tool executions, provider boundaries, costs, and parts-library provenance.

Inspect at minimum:
- license and package metadata
- SQLite support
- migration/schema support
- TypeScript ergonomics
- native build/package risks for better-sqlite3
- examples for transactions and local apps

Answer:
1. Should Prism use Drizzle, Kysely, or plain SQL over better-sqlite3?
2. What schema/migration approach best fits a local-first single-user daemon?
3. How should append-only events and read projections be stored?
4. What packaging risks exist for better-sqlite3?
5. What should Prism avoid, especially around heavy ORMs?
6. What is the smallest event-ledger experiment?

Expected Prism recommendation:
- Prefer explicit SQLite tables.
- Use Drizzle if schema/migration ergonomics matter most.
- Use Kysely if SQL-first clarity matters most.
- Avoid Prisma ORM for the first local ledger.
```

---

# Prompt 11 — MCP SDK and Prism capability-manifest audit

```text
Audit the MCP TypeScript SDK and adjacent plugin/tool architecture references for Prism Spectra.

Repositories:
- https://github.com/modelcontextprotocol/typescript-sdk
- Optional references: Node-RED, Home Assistant integrations, Obsidian plugin API

Prism context:
Prism should support MCP for tool interoperability, but Prism needs richer internal metadata for safety: approval class, risk level, reversibility, local/remote boundary, cost profile, provenance, checkpoint policy, and whether actions are read-only or state-changing.

Inspect at minimum:
- MCP TypeScript SDK README, license, package metadata
- server/client examples
- tool/resource/prompt declarations
- transport examples
- output schema examples
- middleware or auth examples
- plugin/integration metadata ideas from references if useful

Answer:
1. What does MCP provide natively?
2. What safety metadata does MCP not provide that Prism must add?
3. How should Prism import/discover MCP tools?
4. How should Prism prevent extension overload?
5. How should tools be disabled, sandboxed, approved, or boundary-labelled?
6. What is the smallest MCP bridge experiment?

Expected Prism recommendation:
- Use MCP SDK as an interoperability edge.
- Build PrismCapabilityManifest on top.
- Do not allow MCP tools to bypass Prism approval policy.
```

---

# Prompt 12 — Attachment repair utilities audit

```text
Audit attachment and repair utility libraries for Prism Spectra.

Repositories/packages:
- https://github.com/josdejong/jsonrepair
- https://github.com/prettier/prettier
- https://github.com/sindresorhus/file-type
- https://github.com/jshttp/mime-types

Prism context:
Prism's daemon already has or expects attachment upload/download/list/meta/tag/rename/delete/move/compare/repair flows. The UI needs safe repair previews and provenance. Repairs must be visible, reversible when possible, and approval-gated before overwriting originals.

Inspect at minimum:
- license and package metadata
- JSON repair APIs and limitations
- Prettier formatting APIs and supported file types
- file-type detection APIs and binary/magic-number limitations
- MIME mapping APIs
- performance and security warnings

Answer:
1. Which utilities are safe direct dependencies?
2. How should Prism classify attachment types?
3. How should Prism implement repair preview/apply?
4. What provenance metadata should be stored for repairs?
5. Which repairs are safe to suggest automatically, and which need stronger warnings?
6. What is the smallest attachment repair experiment?

Expected Prism recommendation:
- Use these as boring utility dependencies.
- Wrap every repair in preview/diff/approval/checkpoint events.
- Store repair provenance in the event ledger.
```

---

# Prompt 13 — TUI calm-mode framework audit

```text
Audit TUI framework options for a Prism Spectra calm mode.

Repositories:
- https://github.com/vadimdemedes/ink
- https://github.com/Textualize/textual
- https://github.com/charmbracelet/bubbletea

Prism context:
The primary direction is CLI + calm visual workbench. A TUI may become a secondary calm mode for Resume, Approvals, Changes, Run status, and Diffs. Prism's centre of gravity is currently TypeScript/Node, so stack fit matters.

Inspect at minimum:
- license and package metadata
- command/input handling
- layout and keyboard navigation
- testing approach
- examples for trees, lists, command palettes, logs, text areas, and diffs
- browser-serving or remote-display capabilities where relevant

Answer:
1. Which TUI framework best fits Prism's TypeScript/Node stack?
2. Which framework has the best calm/resume/approval affordances?
3. What would a narrow TUI MVP include?
4. What should stay in the browser workbench rather than TUI?
5. What is the smallest TUI experiment?

Expected Prism recommendation:
- Ink is the likely TS-native option.
- Textual is the best UX reference but adds Python stack split.
- Bubble Tea is a strong architectural reference but adds Go stack split.
- Do not build the TUI before the event ledger and approval model exist.
```

---

## Suggested Audit Order

Run these first:

1. Prompt 10 — event ledger storage
2. Prompt 8 — approval diff spine
3. Prompt 9 — git checkpoint wrapper
4. Prompt 1 — Aider repo-map patterns
5. Prompt 11 — MCP + Prism capability manifest

Then run:

6. Prompt 2 — Goose permissions/recipes
7. Prompt 5 — LangGraph interrupts/checkpoints
8. Prompt 6 — Pydantic AI typed outputs/toolsets
9. Prompt 7 — React Flow focused map
10. Prompt 12 — attachment repair utilities
11. Prompt 13 — TUI calm mode
12. Prompt 3/4 — OpenHands and Continue as broader architecture references

## Immediate P0 Harvest Experiments

1. **Event ledger prototype**
   - Drizzle/Kysely + SQLite decision
   - append-only events
   - read projections for Resume, Approvals, Changes

2. **Approval diff prototype**
   - jsdiff patch parser
   - CodeMirror Merge review panel
   - approval-card schema

3. **Git checkpoint wrapper**
   - simple-git service
   - checkpoint/list/diff/rollback-preview commands
   - approval-gated rollback apply

4. **Command mirror prototype**
   - Clipanion/Commander decision
   - typed command metadata
   - UI action to CLI equivalent

5. **Capability manifest prototype**
   - Prism tool schema
   - optional MCP import edge
   - risk/approval/boundary/reversibility fields

## Do Not Harvest Yet

Do not directly import or vendor:

- whole Aider core
- Goose runtime
- OpenHands runtime
- Continue IDE architecture
- LangGraph runtime as Prism's core
- CrewAI as a core abstraction
- AutoGen Studio as a product model
- ComfyUI / ComfyUI-Manager code
- Sourcetrail code
- heavy sync frameworks before local-only ledger exists
- heavy full ORM stack before explicit SQLite tables are proven

## Guiding Rule

Harvest libraries for plumbing. Harvest patterns for architecture. Do not harvest Prism's identity.
