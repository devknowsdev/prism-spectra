# AI-Forge Drift Audit — Session Handover

> **UPDATE: fixes have since been applied and verified.** This document
> captures the reconstruct-and-verify phase (the broken state, fully
> diagnosed, nothing changed yet). See `FIX_REPORT.md` in this same directory
> for what was actually fixed afterward and the final, passing state
> (`npm test` now passes 25/25 with a clean typecheck). This document is kept
> as-is below for the full provenance trail — every file's origin, every
> finding's mechanical confirmation — which `FIX_REPORT.md` builds on rather
> than repeats.

**Date:** 2026-06-20
**Purpose of this session:** Reconstruct the ai-forge-core repo from the documents
the user pasted, file-by-file, verifying each one rather than trusting any prior
session's summary — including the prior (interrupted) session whose own transcript
was pasted in as context. Then run the real `npm run typecheck` / `npm test` and
report exactly what's true right now.

**Status when this note was last updated:** Repo reconstruction is **100% complete**
(all 70 source/test files written and verified) AND **the real `npm run typecheck`
and `npm test` have now actually been run** against the reconstructed repo at
`/home/claude/forge`. Every finding below is now mechanically confirmed via direct
tool output (saved at `/home/claude/forge/typecheck_output.txt` and
`/home/claude/forge/test_output.txt`), not carried over from reading or from the
prior session's transcript. **Still nothing has been fixed** — this session's job
was reconstruct + verify + report, and that's now done. The only remaining step is
writing/delivering the final consolidated report to the user and asking for
direction on a fix.

---

## How to resume in a new session

1. Paste this whole file back in.
2. Paste the same set of documents the user gave me (the uploaded
   `executionEngine.ts` / `index.ts`, plus the big multi-document bundle —
   `PROJECT_BRIEF.md`, `HANDOVER.md`, `docs/architecture/HANDOVER_NEXT_SESSION.md`,
   all the ADRs, all of `src/**`, `test/run.ts`, `package.json`, the tsconfigs).
   Those documents are the **ground truth** — more authoritative than anything in
   this note's prose, in case I mis-typed something below.
3. Pick up at "Next steps" at the bottom.

---

## Repo location

Working copy is being rebuilt at `/home/claude/forge` (a fresh directory, **not**
`/home/claude/ai-forge-core` or `/home/claude/ai-forge-core2`, which were the prior
session's directories — ignore those, they're stale/unverified). `package.json`,
`tsconfig.json`, `tsconfig.test.json` are written and confirmed to match the
documents exactly.

### Files written and verified so far (35 files)

All of these were typed out from the documents verbatim, in this session, and are
sitting on disk at `/home/claude/forge/src/...`:

- **capabilities/** (6 files) — `Capability.ts`, `CapabilityRegistry.ts`,
  `CapabilityRequest.ts`, `CapabilityResult.ts`, `InMemoryCapabilityRegistry.ts`,
  `builtins.ts`. This is the Phase 3 "Capability Layer" PROJECT_BRIEF.md describes.
  It's inert scaffolding (every built-in capability's `execute()` just returns
  `{success:false, error:'Not implemented'}`) and is exported from `index.ts`.
  PROJECT_BRIEF.md's stated constraint ("No Router changes / No ExecutionEngine
  changes / No TaskGraph changes / No Ledger changes / No LearningLoop changes")
  **is honestly satisfied by this layer itself** — nothing in `capabilities/`
  touches those files. (Whether something *else* violated that constraint is a
  separate question — see ControlSurface/TaskGraphContract below.)

- **cli/** (5 files) — `index.ts`, `logs.ts`, `plan.ts`, `replay.ts`, `run.ts`.
  This is a **second, parallel CLI** living alongside the original working
  `src/cli.ts` (singular file, not the directory). Confirmed by direct read:
  - `cli/index.ts` imports `commander` — **not present in `package.json`'s
    `devDependencies`** (verified by reading the actual `package.json` document;
    it only lists `@types/node`, `tsx`, `typescript`). This will fail to resolve.
  - `cli/plan.ts` and `cli/run.ts` both call `new GraphBuilder()` with **zero
    arguments** and `builder.build(intent)` / `builder.build(intent, {...})` with
    a **string + plain object**. The real `GraphBuilder` (in
    `intelligence/graphBuilder.ts`, not yet re-verified file-by-file this session
    but read carefully from the documents) requires
    `new GraphBuilder(memory: MemoryDB, taskHistory: TaskHistory)` and
    `build(input: GraphBuilderInput)` — **one object**, with shape
    `{ graphId, projectId, description, mode? }`. This is a real, confirmed API
    mismatch — `cli/plan.ts` and `cli/run.ts` were written against a GraphBuilder
    that doesn't exist anywhere in this codebase. (This matches what the prior,
    interrupted session also found — I'm independently confirming it, not just
    trusting that transcript.)
  - I have **not yet** actually run `tsc` against these — the above is from
    careful reading, not a compiler run. Treat as "very likely true, pending
    mechanical confirmation" until the typecheck actually runs.

- **config/** (3 files) — `loadConfig.ts`, `modelRegistry.ts`, `providerProbe.ts`.
  Read clean, nothing suspicious. `modelRegistry.ts` is part of the
  FUTURE-INTEGRATION cluster (`taskClassifier`/`modelRegistry`/`localExecutor`/
  `ollamaClient`) per `docs/architecture/HANDOVER_NEXT_SESSION.md`'s own
  classification — excluded from typecheck already, consistent with that doc.

- **core/** (2 files) — `ControlSurface.ts`, `graphFreeze.ts`.
  **Important finding, not yet in any prior session's report:** `ControlSurface`
  has its own `validate(graph)` method that does:
  ```ts
  validate(graph: any) {
    if (!graph || !graph.nodes) throw new Error('invalid graph');
  }
  ```
  This is **a second, independent place** (alongside `TaskGraphContract`,
  see below) that assumes `graph.nodes` is a truthy property — which the real
  `TaskGraph` class does not expose (it's a private `Map`, accessed via `.all()`,
  `.get()`, etc.). `ControlSurface.validate()` is called in
  `executionEngine.ts`'s `run()` **before** `TaskGraphContract.validate()`:
  ```ts
  this.control.validate(graph);     // <-- ControlSurface, checks graph.nodes
  this.contract.validate(graph);    // <-- TaskGraphContract, also checks graph.nodes (array)
  const frozenGraph = this.control.begin(graph);
  ```
  Worth checking carefully once the test run happens: **which of these two
  throws first** determines what error message actually surfaces, and the
  fix has to address both call sites, not just `TaskGraphContract`. (`graph.nodes`
  is `undefined` on a real `TaskGraph`, so `!graph.nodes` is `true` →
  `ControlSurface.validate` should throw `'invalid graph'` *before*
  `TaskGraphContract.validate` ever runs and throws its own, different message
  `'Graph must contain nodes array'`. This needs to be checked by actually
  running it — my reasoning here could be wrong about which one fires first,
  and it's possible the prior session's reported error message
  (`Graph must contain nodes array`) coming from `TaskGraphContract` and not
  `ControlSurface` means my reasoning above has a gap — **flag, don't trust,
  verify mechanically next session**.)
  - `graphFreeze.ts` exports `deepFreezeGraph` — not yet seen imported anywhere.
    Possibly dead code, possibly used somewhere not yet reconstructed. Check once
    everything is in.

- **engine/** (4 files) — `asyncMutex.ts`, `executionEngine.ts`, `fileLock.ts`,
  `modelLock.ts`. `executionEngine.ts` matches the uploaded file exactly
  (both upload copies were identical to each other and to the bundled document).
  This is the file with `this.control.validate(graph); this.contract.validate(graph);`
  — see above.

- **events/** (3 files) — `eventBus.ts`, `runtimeEvents.ts`, `types.ts`. Already
  excluded from typecheck (`tsconfig.test.json`'s exclude list has `src/events/**`),
  consistent with HANDOVER_NEXT_SESSION.md calling this EXPERIMENTAL.

- **executors/** (13 files, fully done) — `aiPrompt.ts`, `claude.ts`, `freeTier.ts`,
  `freeTierMock.ts`, `gpt.ts`, `gptMock.ts`, `index.ts`, `localExecutor.ts`,
  `mockPatch.ts`, `ollama.ts`, `ollamaMock.ts`, `terminal.ts`, `types.ts`. All read
  clean against the documents, no new findings. `localExecutor.ts` is the one file
  in this directory that's part of FUTURE-INTEGRATION (imports `modelRegistry`,
  `ollamaClient`) and is already excluded from typecheck.

- **intelligence/** (2 files) — `graphBuilder.ts`, `learningLoop.ts`. Read clean.
  `graphBuilder.ts` **directly confirms** the `src/cli/plan.ts` / `src/cli/run.ts`
  mismatch (see finding #1 below) by inspection: real constructor is
  `(memory: MemoryDB, taskHistory: TaskHistory)`, real `build()` takes one
  `GraphBuilderInput` object `{graphId, projectId, description, mode?}` — there
  is no zero-arg constructor and no `build(intentString, optionsObject)`
  signature anywhere in this file.

- **memory/** (7 files) — `db.ts`, `ledger.ts`, `ledgerStore.ts`, `patternCache.ts`,
  `replay.ts`, `runStore.ts`, `taskHistory.ts`. All read clean against the
  documents. **New finding:** `memory/runStore.ts` and `runtime/runStore.ts`
  (not yet written, still pending) are **two different classes with the same
  name in different directories** — `memory/runStore.ts`'s `RunStore` has
  `append(log)` / `readAll()` and is what `executionEngine.ts` and `src/cli/logs.ts`
  / `src/cli/replay.ts` actually import and use. `runtime/runStore.ts`'s `RunStore`
  (per the documents, not yet verified on disk) has `createRun()` / `append(run,log)`
  / `finish(run)` — a different shape entirely. Need to confirm once
  `runtime/runStore.ts` is copied over that nothing actually imports the wrong one;
  so far everything I've seen imports from `../memory/runStore.js`, so this may be
  harmless dead-code duplication rather than a real bug — **flag, don't conclude**.

- **planning/** (1 file) — `PlanningSnapshot.ts`. **New finding, useful context for
  finding #1 below:** this interface's shape
  (`{recentFailures, costBudget: {remaining, tier}, systemHints: {preferLocal, maxDepth?}}`)
  is *exactly* the object literal `src/cli/run.ts` passes as `GraphBuilder.build()`'s
  second argument. This suggests `cli/run.ts` wasn't written against nothing — it
  was written against `PlanningSnapshot`, just plugged into the wrong function/API.
  Doesn't change the finding (the call is still broken against the real
  `GraphBuilder`), but explains *why* the broken call has the shape it does, which
  may matter when proposing a fix later (e.g. is `PlanningSnapshot` meant to flow
  into `GraphBuilderInput` somehow, or is it for a different, not-yet-built
  component entirely?).

- **providers/** (1 file) — `ollamaClient.ts`. Read clean. Part of
  FUTURE-INTEGRATION, already excluded from typecheck.

- **routing/** (3 files) — `router.ts`, `taskClassifier.ts`, `types.ts`. Read clean
  against the documents, but two new findings:
  - `router.ts` exports only the `Router` **class** with a `.route()` method —
    confirmed **no `routeTask` function export exists** anywhere in this file.
    This matters once `runtime/executionCoordinator.ts` is copied over (not yet
    done) — the documents show it doing
    `import { routeTask } from '../routing/router';`, which would fail to resolve
    against the real file. (Per `docs/architecture/HANDOVER_NEXT_SESSION.md`, this
    was the prior, *earlier* session's finding, already handled by excluding
    `src/runtime/**` from typecheck — so this is expected/already-mitigated, not
    a new live bug. Re-confirming it's still true of the current file is still
    useful groundwork for the final report.)
  - `routing/types.ts` defines its own `RouteDecision` interface
    (`{taskType, executor: ModelId, plannerRequired, validationRequired, confidence}`)
    — **a different, incompatible shape from the `RouteDecision` exported by
    `routing/router.ts`** (`{executor: ExecutorName | null, chainTried}`). Same
    name, two shapes, two files, same directory. Both `routing/taskClassifier.ts`
    and `routing/types.ts` are already excluded from typecheck, so this is
    currently inert, but worth naming in the final report as a landmine for
    anyone who later imports `RouteDecision` from the wrong path. Also:
    `taskClassifier.ts` imports `zod`, which is **also** absent from
    `package.json` — but since this file is excluded from typecheck, it's a
    non-issue under the current tsconfig, unlike the `commander` situation in
    `src/cli/index.ts` which is NOT excluded.

- **runtime/** (9 files, fully done) — `errors.ts`, `executionContext.ts`,
  `executionCoordinator.ts`, `health.ts`, `resourceScheduler.ts`, `runStore.ts`,
  `runtimeRegistry.ts`, `state.ts`, `validator.ts`. All already excluded from
  typecheck (`src/runtime/**`), consistent with HANDOVER_NEXT_SESSION.md's
  EXPERIMENTAL classification. Findings:
  - **`executionCoordinator.ts` confirmed, by direct read with the real
    `router.ts` already on disk, to import a `routeTask` function that does not
    exist** (`router.ts` only exports the `Router` class). This is the exact
    historical bug `docs/architecture/HANDOVER_NEXT_SESSION.md` describes as
    already-mitigated via the exclude list — re-confirmed true of the current
    file, not just asserted from the doc.
  - **`runtime/executionContext.ts` imports a *third*, separately incompatible
    `RouteDecision` shape**, this time from `../types/contracts`
    (`{taskType: string, executor: string, confidence, plannerRequired?,
    validationRequired?}`). Combined with `routing/router.ts`'s version and
    `routing/types.ts`'s version, **there are now three different `RouteDecision`
    interfaces across the repo**, none compatible with each other. All three
    call sites are currently outside the typecheck's included scope
    (`src/runtime/**` and `routing/types.ts` both excluded), so this is inert
    today, but worth naming as a "do not consolidate carelessly" warning for any
    future integration of the runtime/ cluster.
  - **`runtime/runStore.ts` confirmed to be a genuinely different `RunStore`
    class from `memory/runStore.ts`** (see finding #5) — `createRun()` /
    `append(run, log)` / `finish(run)`, returning a file path, vs. the
    `memory/` version's `append(log)` / `readAll()`. Both now exist on disk
    simultaneously and are confirmed structurally distinct, not just
    suspected-distinct from reading.

- **safety/** (3 files, fully done) — `checkpoint.ts`, `patch.ts`, `validation.ts`.
  Read clean, no new findings beyond what's already documented in the files'
  own extensive docblocks (git-HEAD-race fix via `AsyncMutex`, write-only patch
  model, automated-only validation gates).

- **taskGraph/** (2 files, fully done) — `graph.ts`, `graphContract.ts`. **This is
  where finding #3 (`ControlSurface` vs `TaskGraphContract`) got mechanically
  resolved** — see the "Known findings" section, #3, for the full resolution.
  Short version: `TaskGraph.nodes` is a TS `private` (not `#private`) field
  initialized to `new Map()`. TS `private` is compile-time-only, so at runtime
  `graph.nodes` is a real, truthy `Map` object. `ControlSurface.validate()`'s
  `!graph.nodes` check is satisfied (Map is truthy) and does NOT throw.
  `TaskGraphContract.validateStructure()`'s `Array.isArray(graph.nodes)` check
  DOES throw, because a `Map` is not an `Array` — this is the actual, sole,
  confirmed source of every `"Graph must contain nodes array"` error.
  Additionally confirmed: `TaskGraph`'s only public surface for reading nodes is
  `get(id)`, `all()`, plus the status/readiness helpers — there is no path to a
  `.nodes` array at all, by design (per the file's own docblock about
  direct-dependents-only blocking).

- **telemetry/** (1 file), **types.ts + types/** (3 files), **wizard/** (1 file),
  **src/cli.ts**, **src/demo.ts**, **src/index.ts**, **test/run.ts** (7 files) —
  all written and read clean except for the cross-file `RouteDecision` /
  `ExecutionResult` shape duplication noted below. Notably: **`src/cli.ts`
  (the original, singular CLI) calls `GraphBuilder` correctly** —
  `new GraphBuilder(engine.memory, engine.taskHistory)` and
  `wizard.buildPlan(graphBuilder, {graphId, projectId})` — confirming this is
  solid, working code, in contrast to the broken `src/cli/run.ts` and
  `src/cli/plan.ts`. Also confirmed: `types/contracts.ts` defines yet another
  incompatible `RouteDecision` (a *third* shape, distinct from both
  `routing/router.ts`'s and `routing/types.ts`'s versions) and an incompatible
  `ExecutionResult` (`{output, modelUsed, durationMs}` vs. the canonical
  `types.ts` version's `{success, output, provider, tokensIn, ...}`) — both
  used only inside the already-excluded `runtime/*` cluster, so currently inert.

### Reconstruction: 100% complete (70/70 files), all on disk at `/home/claude/forge`

## REAL typecheck/test results (mechanically run, not inferred — this is the part
## that matters most for the final report)

### `npx tsc --noEmit -p tsconfig.test.json` — full, complete, real output (8 errors):

```
src/cli/index.ts(3,25): error TS2307: Cannot find module 'commander' or its corresponding type declarations.
src/cli/plan.ts(4,19): error TS2554: Expected 2 arguments, but got 0.
src/cli/plan.ts(6,31): error TS2345: Argument of type 'string' is not assignable to parameter of type 'GraphBuilderInput'.
src/cli/run.ts(15,19): error TS2554: Expected 2 arguments, but got 0.
src/cli/run.ts(16,39): error TS2554: Expected 1 arguments, but got 2.
src/cli/run.ts(23,36): error TS2345: Argument of type 'Promise<BuildOutcome>' is not assignable to parameter of type 'TaskGraph'.
  Type 'Promise<BuildOutcome>' is missing the following properties from type 'TaskGraph': id, projectId, nodes, assertAcyclic, and 8 more.
src/engine/executionEngine.ts(104,52): error TS7006: Parameter 'id' implicitly has an 'any' type.
```

Every line here independently confirms a finding already documented above by
reading — nothing new in terms of *which* files are broken, but this is the
first time it's been proven by the compiler rather than inferred. One precise
new detail: the implicit-any error is specifically at
`executionEngine.ts:104:52`, the `ready.map((id) => this.runNode(...))` call
inside the `"parallel"` branch of `run()`. Root cause, confirmed by reading
`ControlSurface.begin()`'s signature: `begin(graph: any)` has no return type
annotation, so TypeScript infers its return as `any`. That makes
`frozenGraph: any` in `executionEngine.ts`, so `frozenGraph.readyNodeIds()` is
`any`, so `ready` is `any` (not `any[]`), and `.map((id) => ...)` on a bare
`any` trips `noImplicitAny` in a way it wouldn't if `ready` were typed
`string[]`. **This is a `ControlSurface` typing hole, not an
`executionEngine.ts` logic bug** — fixing `ControlSurface.begin()`'s return
type (e.g. typing it as a generic `<T>(graph: T): T` instead of
`(graph: any): any`) would likely resolve this specific error as a side
effect, separately from the `TaskGraphContract`/`graph.nodes` issue.

### `npx tsx test/run.ts` — full, complete, real output (10 of 25 pass, 15 fail):

Saved verbatim at `/home/claude/forge/test_output.txt`. Pass/fail list:

```
FAIL  - sequential graph respects dependency order and all nodes succeed
  ok  - cycle in dependencies is rejected at graph construction
FAIL  - pattern cache hit skips execution and reuses original output
FAIL  - a failed node blocks only its direct dependent; unrelated sibling still succeeds
FAIL  - git checkpoint is reverted when a node fails (working tree shows no trace of the failed attempt)
FAIL  - ledger fallback: exhausting a tier's budget routes the next call to the next tier
FAIL  - terminal node requires an explicit command and never falls back to intent text
FAIL  - file-level locking serializes nodes sharing a path; independent nodes are unaffected
  ok  - static fallback templates are valid, acyclic node sets for every wizard mode
  ok  - GraphBuilder.build() degrades to the fallback template when no API key is set
FAIL  - GraphBuilder surfaces relevant past failures for a similar new task
FAIL  - concurrent checkpoints for nodes with NO shared file paths don't race on git's HEAD ref
  ok  - applyPatch writes files (creating parent dirs), deletes files, and rejects paths escaping workDir
FAIL  - an AI-tier node (ollama mock) really writes a file via its patch, checkpointed by git
FAIL  - a validation failure rolls back a patch-written file, not just terminal-written ones
FAIL  - a cache hit replays the original patch, not just the text output
  ok  - LocalModelLock: same-model calls incur no swap delay, a model switch does
  ok  - selectModel routes coding node types to the coder model and others to the general model
FAIL  - two ollama nodes needing DIFFERENT models never run concurrently, even in 'parallel' mode
  ok  - data boundary: local providers are 'local', free_tier is flagged as may-train, gpt/claude are not
FAIL  - data boundary is actually persisted per call, not just computed transiently
  ok  - Wizard never exceeds the 3-question ceiling, for any mode
  ok  - Wizard enforces answering in order and rejects skipping a required question
  ok  - Wizard.buildPlan() refuses to run before all required questions are answered
FAIL  - WizardPlan withholds the executable graph until confirm() — no code exposure in summary/steps
10 test(s) passed.
```

**Mechanically confirmed (via `grep -c` on the saved output): all 15 failures
throw the exact same error, verbatim: `Error: Graph must contain nodes array`.**
Every failing stack trace traces through
`TaskGraphContract.validateStructure` → `TaskGraphContract.validate` →
`ExecutionEngine.run` — and **`ControlSurface` never appears in any stack
trace.** This resolves finding #3 completely and finally: confirmed by an
isolated repro (`new ControlSurface().validate(realTaskGraphInstance)`) that
`ControlSurface.validate()` does NOT throw on a real `TaskGraph` — it's a
weak (truthiness-only) check satisfied by the real `TaskGraph`'s initialized-
but-private `Map`. `TaskGraphContract.validateStructure()`'s
`Array.isArray(graph.nodes)` is strict and correctly identifies that a `Map`
is not an `Array` — it is the **sole, confirmed, mechanically-verified source**
of every one of these 15 failures.

**Also mechanically confirmed (separate isolated repro, not just read):** even
if the `.nodes`-array problem were fixed, `TaskGraphContract`'s cycle/self-
dependency checks would still silently no-op. Direct test: constructed a real
`TaskGraph` with a genuine dependency edge, inspected the resulting `GraphNode`
— `node.dependsOn` is `undefined`, `node.dependencies` is `undefined`, and the
real dependency list lives only at `node.packet.dependencies`. So
`node.dependsOn ?? node.dependencies` (used throughout
`validateNoSelfDependencies` and `validateAcyclic`) evaluates to `undefined`
for every real node, meaning these two checks currently validate nothing
against real graphs — a second, independent latent defect in
`TaskGraphContract`, separate from the `.nodes`-array problem, confirmed by
direct test rather than inference.

## Consolidated, final list of confirmed problems (ready to report to the user)

1. **SEVERE — `TaskGraphContract.validate()` breaks every real execution.**
   Mechanically confirmed: 15/25 tests fail, 100% of failures are the
   identical `Error: Graph must contain nodes array`, thrown from
   `TaskGraphContract.validateStructure()`, called unconditionally as the
   second line of `ExecutionEngine.run()`. The real `TaskGraph` class has no
   public `.nodes` array by design (private `Map`, exposed via `.all()`/`.get()`
   — see the class's own docblock about why). This affects the CLI, the demo,
   and every test that calls `engine.run()` with a real graph. Additionally,
   even past that immediate blocker, `TaskGraphContract`'s cycle/self-dependency
   validation reads `node.dependsOn ?? node.dependencies`, but real nodes carry
   dependencies at `node.packet.dependencies` — confirmed those checks
   currently validate nothing.
2. **`ControlSurface.validate()` has the same wrong assumption but is currently
   harmless** — confirmed it never actually throws on a real `TaskGraph`
   (its check is satisfied by any truthy value, and the real `TaskGraph`'s
   private `Map` field is truthy at runtime since TS `private` is compile-time-
   only). Worth fixing alongside `TaskGraphContract` for correctness, but it is
   not what's currently breaking things.
3. **`ControlSurface.begin(graph: any): any` is also the confirmed root cause
   of the one `noImplicitAny` typecheck error** in `executionEngine.ts`
   (`ready.map((id) => ...)` in the parallel-mode branch) — `frozenGraph`
   inherits `any` from `begin()`'s untyped signature, cascading into `ready`
   being bare `any` instead of `string[]`.
4. **`src/cli/plan.ts` and `src/cli/run.ts` call a `GraphBuilder` API that
   doesn't exist** — confirmed via both reading `intelligence/graphBuilder.ts`
   directly and via the compiler's own error messages (`Expected 2 arguments,
   but got 0`, etc.). The real constructor is
   `(memory: MemoryDB, taskHistory: TaskHistory)`; the real `build()` takes one
   `GraphBuilderInput` object. Bonus context: the broken call's second-argument
   shape in `cli/run.ts` exactly matches `planning/PlanningSnapshot.ts`'s
   interface — so this wasn't written against nothing, it was written against
   the wrong target.
5. **`src/cli/index.ts` imports `commander`, missing from `package.json`** —
   confirmed both by reading and by the compiler (`Cannot find module
   'commander'`).
6. **Three mutually-incompatible `RouteDecision` interfaces** exist across the
   repo (`routing/router.ts`, `routing/types.ts`, `types/contracts.ts`), plus
   **two incompatible `ExecutionResult` interfaces** (`types.ts` canonical vs.
   `types/contracts.ts`). All currently inert because every conflicting
   definition lives in a file already excluded from the typecheck
   (`routing/types.ts`, everything importing from `types/contracts.ts` is only
   reached via the excluded `src/runtime/**`). Named as a landmine for any
   future work that tries to integrate the `runtime/*` cluster without
   reconciling these shapes first.
7. **Two mutually-incompatible `RunStore` classes** (`memory/runStore.ts`:
   `append(log)`/`readAll()`, vs. `runtime/runStore.ts`:
   `createRun()`/`append(run,log)`/`finish(run)`). Confirmed, by checking every
   import site seen this session, that everything currently in active use
   (`executionEngine.ts`, `src/cli/logs.ts`, `src/cli/replay.ts`) imports the
   `memory/` version. The `runtime/` version is currently unused dead code, as
   far as this session's reconstruction shows — not a live bug, but worth
   flagging for cleanup.

## What's confirmed still correct / working

- `src/routing/router.ts` (the `Router` class) — unchanged, confirmed correct,
  matches its own extensive docblock's documented contract.
- `src/cli.ts` (singular, original CLI) — confirmed correct `GraphBuilder` usage,
  in direct contrast to the broken `src/cli/` directory.
- The previously-resolved `executionCoordinator.ts` / `routeTask` issue from an
  earlier session — re-confirmed still real in the current file
  (`router.ts` genuinely exports no `routeTask`), and re-confirmed still
  successfully mitigated via `tsconfig.test.json`'s `src/runtime/**` exclude.
- The 10 passing tests (Wizard mechanics, `LocalModelLock` timing,
  `applyPatch`'s own unit-level behavior, `staticFallbackNodes`/`GraphBuilder`
  fallback behavior, data-boundary-by-provider lookup) pass because they either
  never call `engine.run()` with a real `TaskGraph`, or fail before reaching
  the contract check for unrelated, already-tested-as-correct reasons.

## Next step: write and deliver the final report to the user

Reconstruction and verification are done. The remaining work is purely
presentational: write the consolidated report (the "Consolidated, final list
of confirmed problems" section above is essentially report-ready), and ask the
user whether they want:
(a) a concrete proposed fix for `TaskGraphContract` (e.g. read `graph.all()`
    and `node.packet.dependencies` instead of the assumed shape), or
(b) to treat `ControlSurface`/`TaskGraphContract`/the `src/cli/` directory the
    same way `docs/architecture/HANDOVER_NEXT_SESSION.md` treats
    `runtime/*`/`events/*` — i.e., not-yet-integrated/EXPERIMENTAL, to be
    excluded from typecheck and left for a deliberate future integration pass
    rather than patched now.

Per this project's standing pattern (`PROJECT_BRIEF.md`, multiple past
sessions): **do not pick a direction unilaterally — report precisely, then
let the user decide.**
