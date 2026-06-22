# AI-Forge Drift Audit — Fix Report

**Date:** 2026-06-20/21
**Result: `npm test` now passes cleanly end-to-end** (`tsc --noEmit -p tsconfig.test.json`
→ 0 errors; `tsx test/run.ts` → 25/25 tests pass, confirmed stable across 3
consecutive runs). The repo at `/home/claude/forge` is the verified, fixed
state. This document supersedes `SESSION_HANDOVER.md`'s "next steps" section —
that work is now done.

This was a continuation of a full reconstruct-and-verify audit (see
`SESSION_HANDOVER.md` for the complete file-by-file provenance of every file
in this repo, and the raw `typecheck_output.txt` / `test_output.txt` showing
the *broken* state before any fix was applied). This document covers only
the fixes applied after that point, and the verification of each one.

---

## Fixes applied, in the order they were made

### 1. `src/taskGraph/graphContract.ts` — rewritten to read the real `TaskGraph` shape

**Problem (confirmed mechanically before fixing):** `validateStructure()`
required `Array.isArray(graph.nodes)`, but the real `TaskGraph` class has no
public `.nodes` — it's a private `Map`, exposed only via `.all()`/`.get(id)`.
This threw `"Graph must contain nodes array"` on every real execution. Even
past that, `validateNoSelfDependencies()`/`validateAcyclic()` read
`node.dependsOn ?? node.dependencies`, but real `GraphNode`s carry their
dependency list at `node.packet.dependencies` — confirmed by direct test that
both `node.dependsOn` and `node.dependencies` are `undefined` on a real node,
so these checks would have silently validated nothing even if the `.nodes`
problem were fixed.

**Fix:** Changed every method to accept `graph: TaskGraph` (not `any`) and to
read via `graph.all()` and `node.packet.dependencies`. `validateStructure()`
now checks `typeof graph.all !== "function"` instead of `Array.isArray(graph.nodes)`
— a check against the real contract a `TaskGraph` instance actually offers.

**Note left in the code:** `TaskGraph`'s own constructor already enforces
acyclic-by-construction and rejects unknown dependency ids (`assertAcyclic()`),
so `validateNoSelfDependencies()`/`validateAcyclic()` are now genuinely
redundant for any graph that successfully constructed. Left in place as a
cheap defensive boundary rather than removed, since removing them wasn't
asked for and they cost nothing now that they're reading the right fields.

### 2. `src/core/ControlSurface.ts` — typed `begin()`, tightened `validate()`

**Problem (confirmed mechanically before fixing):** `begin(graph: any): any`
caused TypeScript to infer an `any` return, which cascaded into the one
`noImplicitAny` typecheck error in `executionEngine.ts`
(`ready.map((id) => ...)` losing its element type because `ready` came from
an `any`-typed `frozenGraph`). Separately, `validate()`'s `!graph.nodes`
check was a truthiness check, not a shape check — confirmed by isolated
repro that it never actually throws on a real `TaskGraph` (a TS `private`
field initialized to `new Map()` is still a truthy *runtime* property, since
TS `private` is compile-time-only).

**Fix:** `begin<T>(graph: T): T` — a generic pass-through, preserving the
class's actual behavior (single-active-execution guard around an opaque
value) while removing the `any` leak. `validate(graph: TaskGraph)` now checks
`typeof graph.all !== "function"`, the same real-shape check used in
`graphContract.ts`, rather than mere truthiness.

**Verification:** re-ran `npx tsc --noEmit -p tsconfig.test.json` immediately
after this fix (before touching anything else) — the `executionEngine.ts`
implicit-any error was gone, confirming the inference chain diagnosis was
correct.

### 3. `src/safety/checkpoint.ts` — excluded `.forge/` from checkpoint sweeps; fixed `hadChanges` to match

**Problem (found and confirmed via isolated repro, not carried over from any
prior session's claim):** `memory/runStore.ts`'s `RunStore` writes
`.forge/runs.jsonl` inside `workDir` at construction time. A node with no
declared patch falls back to `listChangedPaths()` (`git status --porcelain
--untracked-files=all`), which picked up `.forge/runs.jsonl` as an untracked
file, staged it, and committed it as part of that node's checkpoint. If that
same node then failed validation, `rollback()`'s `git revert` of that
checkpoint deleted `.forge/runs.jsonl` from disk as a side effect of
reverting its own addition. The very next thing `executionEngine.ts`'s
`runNode()` does is call `runStore.append()` on that now-deleted file,
throwing `ENOENT: no such file or directory`. Reproduced this from a clean
single-node repro (not requiring any prior successful node) to confirm the
mechanism precisely before touching any code.

**Fix, two parts:**
- `listChangedPaths()` now filters out `.forge` / `.forge/*` — AI Forge's own
  run-log bookkeeping should never be subject to the same git
  checkpoint/rollback lifecycle as the task workspace content it's executing
  on behalf of the user.
- `checkpoint()`'s `hadChanges` check was changed from `git status --porcelain`
  (which still reports `.forge/` as changed, since the exclusion above only
  affects what gets *staged*) to `git diff --cached --name-only` (which
  reports only what's actually staged) — **this second fix was necessary
  because the first one alone caused a regression**: without it, a node with
  only `.forge/`-only changes would see `hadChanges = true` (untracked file
  still visible to `git status`) but have nothing actually staged, so the
  non-`--allow-empty` `git commit` would fail with "nothing to commit",
  surfacing as a generic `Command failed: git commit` error. Caught this via
  a full test-suite re-run immediately after the first fix (20/25 passing
  dropped to 13/25 — a clear regression signal), diagnosed it, and fixed it
  before moving on, rather than declaring victory on a still-broken
  intermediate state.

**Verification:** full test suite went 10/25 (original broken state, all
identical `Graph must contain nodes array`) → 20/25 (after fixes #1–#2, before
this fix; the remaining 5 failures were 4× this exact `ENOENT` and 1× the
`git commit` issue described above) → 13/25 (regression after the
incomplete first half of this fix) → 25/25 (after both halves of this fix).

### 4. `src/memory/runStore.ts` — `append()` self-heals if the file is missing

**Defense in depth, not required by any remaining failure** once fix #3 was
in place, but added anyway: `append()` now recreates the file/directory if
missing instead of throwing `ENOENT` unconditionally. Rationale documented in
the code: `.forge/` is meant to be fully excluded from `CheckpointManager`'s
git lifecycle now, so this shouldn't trigger in practice, but it costs
nothing to not have `RunStore`'s correctness depend entirely on that
exclusion never being bypassed by some future code path.

### 5. `src/cli/plan.ts` and `src/cli/run.ts` — fixed to call the real `GraphBuilder` API

**Problem (confirmed by both reading and the compiler's own error messages):**
both files called `new GraphBuilder()` with zero arguments and `builder.build()`
with a bare string (`plan.ts`) or a string plus a `PlanningSnapshot`-shaped
options object (`run.ts`) — neither matches the real
`GraphBuilder(memory, taskHistory)` constructor or the real single-object
`build(input: GraphBuilderInput)` signature. `run.ts` additionally passed the
unresolved `Promise<BuildOutcome>` straight into `engine.run()`, which expects
a `TaskGraph`.

**Fix:**
- `plan.ts`: constructs a `MemoryDB`/`TaskHistory` pair (this is a one-shot
  preview command with no existing engine to borrow from), builds a real
  `GraphBuilderInput` (`{graphId, projectId: "cli", description: intent}`),
  awaits the real `build()`, and prints `outcome.graph.all()`.
- `run.ts`: builds the `GraphBuilder` from the `ExecutionEngine` instance's
  own `.memory`/`.taskHistory` (avoiding a second, redundant `MemoryDB`
  against the same `dbPath`), awaits the real `build()`, and passes
  `outcome.graph` (not the unresolved promise) into `engine.run()`.

**Verification:** typecheck error count for these two files went from 5 to 0.
Additionally smoke-tested both commands at runtime
(`AI_FORGE_MOCK_EXECUTORS=1 npx tsx src/cli/index.ts plan "..."` and
`... run "..."`) — both produce correct, real output (a real generated
`TaskGraph` for `plan`, real `NodeRunLog[]` execution results for `run`).
Also smoke-tested `src/cli/logs.ts` afterward against the `.forge/runs.jsonl`
that `run`'s execution had just written — confirmed it reads back correctly.

### 6. `commander` — added as a real dependency

**Problem:** `src/cli/index.ts` imports `commander`, absent from
`package.json`.

**Fix:** `npm install commander --save` — genuinely installed (network egress
to `registry.npmjs.org` is allowed in this environment), not stubbed around.
`package.json` now has a `dependencies` section with `commander: ^15.0.0`.

---

## What was deliberately NOT changed

- **The three incompatible `RouteDecision` interfaces** (`routing/router.ts`,
  `routing/types.ts`, `types/contracts.ts`) and **two incompatible
  `RunStore` classes** (`memory/runStore.ts`, `runtime/runStore.ts`) — both
  noted in `SESSION_HANDOVER.md` as landmines, both currently inert (every
  conflicting definition lives inside the `src/runtime/**`-excluded cluster
  or in a file already excluded from typecheck). Not touched because fixing
  these would mean either deleting code or making a design call about which
  shape is canonical for not-yet-integrated future work — exactly the kind
  of decision this project's standing pattern says to surface, not make
  unilaterally.
- **`src/runtime/**`, `src/events/**`, and the other already-excluded
  FUTURE-INTEGRATION/EXPERIMENTAL files** — left exactly as documented in
  `docs/architecture/HANDOVER_NEXT_SESSION.md`'s own classification. No
  reason found this session to change that classification.
- **`TaskGraphContract`/`ControlSurface`'s now-redundant cycle/self-dependency
  re-checks** — not removed, see note in fix #1 above.

## Final verification commands (all run and confirmed passing in this session)

```
npx tsc --noEmit -p tsconfig.test.json   # 0 errors
npm test                                  # pretest (typecheck) + tsx test/run.ts → 25/25 pass
npx tsx src/demo.ts                       # full 11-section walkthrough completes clean
npx tsx src/cli.ts --status               # original CLI still works
npx tsx src/cli/index.ts plan "..."       # fixed parallel CLI: plan command works
npx tsx src/cli/index.ts run "..."        # fixed parallel CLI: run command works
npx tsx src/cli/index.ts logs             # fixed parallel CLI: logs command works
```

Test suite re-run 3 times consecutively post-fix to rule out flakiness from
timing-sensitive tests (model-lock swap delays, file-lock interleaving) — all
3 runs: 25/25.
