# Handover — Continue Spectra Cockpit/Engine Coherence Research → Codex Implementation Plan

**For:** A new Claude session continuing this work
**From:** Claude session, 2026-06-30
**Branch:** `spectra-project-cockpit-20260629` (prism-spectra)
**Eventual target:** A Codex-ready implementation prompt, using `prism-beam/templates/CODEX_PROMPT_MINI.md`

---

## First response format (per Beam's `AI_PROMPT_ROUTER.md`)

Open your first reply with this, filled in:

```text
Selected profile: CLAUDE.md (extended — this is a research-continuation session, not a single bounded review)
Selected route: 4 (Spectra implementation/architecture) + 9 (handover generation)
Progress log status: [check AI_PROGRESS_LOG.md in prism-beam — see §6 below]
Estimated task size: large
Usage risk: medium — this touches src/engine/executionEngine.ts, the core execution path
Delegation needed: no — finish verification yourself, then hand off to Codex
Beam files read: TINY_BOOT.md, current-state.min.md, SUITE_AI_ENGINE_BOUNDARY.md, this handover
Source escalation needed: yes — src/engine/executionEngine.ts, src/routing/router.ts
Next action: complete the verification listed in §3, then produce the Codex handover per §5
```

---

## 0. Read first

1. `prism-beam/ai-guides/TINY_BOOT.md`
2. `prism-beam/context-packs/workspace/current-state.min.md`
3. `prism-beam/docs/contracts/SUITE_AI_ENGINE_BOUNDARY.md`
4. This document, in full, before touching source

Three documents were produced in the prior session and should be read before doing any new work. Dave should attach or paste these into this session (they were generated as local outputs, not yet committed to a repo — see §7, which recommends fixing that):

- **`COCKPIT_AUDIT_20260629.md`** — the original UX/IA audit of the cockpit's guided-layer design (information architecture, state machine, action-packet schema v0, safety model, neurodivergent-UX principles, 5-slice implementation plan, PID-bug root cause and fix).
- **`COCKPIT_BRIDGE_VERIFICATION_AUDIT_20260630.md`** — verification of GPT's implementation against the live repo (cloned the branch, ran `npm run test:cockpit` / `typecheck` / `test:ai-request` directly rather than trusting the report; confirmed PID fix, guided panel, RPM budget fix, and the read-only `riskClass` contract enforcement all genuinely work; flagged one unrelated pre-existing test failure in `test/run.ts` — `e2e: daemon execute-graph and rollback via API` — not investigated, not part of this branch's scope, worth a look before any PR).
- **`COCKPIT_APPROVAL_LEDGER_COHERENCE_HANDOVER_20260630.md`** — a fully scoped, Codex-ready implementation handover that replaces the cockpit's bespoke `CockpitActionPacket` system with the suite's real `ApprovalQueue`/`PrismEventLedger` (`src/approvals`, `src/events`). This one is **already complete and ready to hand to Codex as-is** — see §4 for sequencing.

---

## 1. What this session is for

The previous session's audits established that the cockpit's UI/approval layer had drifted from Spectra's existing suite primitives (it reinvented an approval/risk system instead of using `ApprovalQueue`/`PrismEventLedger`, which already existed, fully implemented, and already used by the Spectra Workbench at `/workbench`). That finding is fully resolved — `COCKPIT_APPROVAL_LEDGER_COHERENCE_HANDOVER_20260630.md` is a complete, scoped fix, ready for Codex.

Pushing one level deeper than the cockpit's UI surfaced something more significant, **not yet fully verified, and not yet turned into an implementation handover.** This session's job is to finish verifying it and produce the Codex handover for it.

---

## 2. The core finding — confirmed but not yet fully traced

**The Focus↔Spectra bridge request path (`/api/v1/ai/request` → `ExecutionEngine.runAiRequest()`) does not use most of Spectra's actual routing intelligence**, even though that intelligence is real, tested, and already live on `main` (per `current-state.min.md`: "Spectra routing work is merged through Tier 3c on `devknowsdev/prism-spectra:main`: Tier 2b routing intelligence, Tier 3a semantic cache, Tier 3b route decision cache hints/engine wiring, and Tier 3c telemetry/export hardening").

Confirmed by reading source directly (`src/engine/executionEngine.ts`):

- `runAiRequest()` (the method the Focus bridge actually calls) does call `this.route(packet)` — gets a real routing decision and route-cache hint. That part is genuine.
- `runAiRequest()` calls `executeViaRoute()`, which for Ollama computes `scoreLocalResult()` → a real confidence score (`scoreLocalConfidence`, heuristic: penalizes hedging language, placeholder text, short output; rewards longer output and high L1-classifier confidence).
- **That confidence score is computed and then discarded.** It is not in the `AiRequestSuccess`/`AiRequestFailure` return shape. Focus never sees it.
- **`runAiRequest()` never calls `lowConfidenceFallbackReason()`** — the method that would trigger cascade escalation to a better tier on a low-confidence local answer. That logic exists and is wired in, but only inside `runNode()` (the graph-execution method the daemon uses for coding/patch tasks), at approximately line 368 of `executionEngine.ts`.
- **`runAiRequest()` never calls the pattern cache** (`lookupCache`, exact + semantic matching). `runNode()` checks this before doing any work. `runAiRequest()` always executes from scratch, even for a near-identical repeated Focus question.

In short: `runAiRequest` is a separate, hand-written, simplified reimplementation of part of what `runNode` already does correctly. This is the same category of problem the cockpit's approval system had — drift from an existing, better suite primitive — except this one is in the core engine, not a UI layer, and it directly determines whether Focus gets Spectra's actual intelligence or a single-shot local guess with no quality gate.

**ADR-010 (`docs/adr/ADR-010-routing-intelligence-architecture.md`), status "Accepted,"** describes exactly this cascade pattern as the intended architecture: route → execute → quality-gate check → escalate only if quality is below threshold. It is built. It is tested (via `runNode`'s test coverage in `test/run.ts`). It just isn't reachable from the endpoint Focus actually calls.

---

## 3. What still needs verification before this becomes a Codex handover

These were flagged as open at the end of the prior session — do not write an implementation handover until they're checked:

1. **Trace `runNode`'s cache/retry loop in full detail** (`src/engine/executionEngine.ts`, the method body starting around line 318, specifically the `while (this.fallbackOnFailure && decision.executor)` loop). Confirm exactly what state it threads through on each retry iteration (`chainTried`, `routeCacheHit`, `tried: ExecutorName[]`) so a shared extraction can preserve all of it correctly for both callers.

2. **Confirm the file-lock and patch-related steps in `runNode` are genuine no-ops for a read-only, `docs`-type packet** (the shape `runAiRequest` constructs: `node_type: "docs"`, `constraints: ["read-only", "no-app-mutation", "no-file-write"]`). Specifically check:
   - `this.fileLocks.acquire(packet.filePaths)` — confirm `packet.filePaths` is genuinely empty/undefined for an ai-request-shaped packet, so this lock acquisition is free and harmless.
   - The cache lookup's `cacheLookup.originPatch` field — confirm that for a `docs`-type, read-only packet, no patch is ever produced or expected, so reusing the cache-lookup path doesn't risk surfacing or applying a write operation through a read-only endpoint.
   - This check matters because it's the one place a "rebuild, don't patch" refactor could accidentally weaken the `riskClass=read-only` guarantee that was confirmed solid in the previous session's verification audit. That guarantee must survive this refactor exactly as-is.

3. **Decide the exact extraction shape.** The recommended direction (not yet finalized into code) is: pull the shared sequence — cache lookup → route → execute → score/confidence-check → retry-on-low-confidence-or-failure — out of `runNode` into one internal method (e.g. `private async executeWithCascade(packet: TaskPacket): Promise<{ result: ExecutionResult; chainTried: ChainAttempt[]; routeCacheHit?: boolean; routeCacheSimilarity?: number }>`), then have both `runNode` and `runAiRequest` call it, each wrapping the result in their own return shape (`NodeRunLog` vs `AiRequestSuccess`/`AiRequestFailure`). Confirm this shape actually fits both call sites cleanly before handing it to Codex — if there's a real divergence (e.g. `runNode`'s patch-handling genuinely can't be separated cleanly from the cascade loop), say so plainly rather than forcing a shared method that doesn't fit.

4. **Decide whether `confidenceScore` should be added to `AiRequestSuccess`** so Focus can eventually display it, or kept internal-only for now (used only to decide whether to escalate, not exposed). Either is defensible — recommend checking whether `docs/FOCUS_AI_INIT.md` or `docs/AI_REQUEST_GATEWAY.md` say anything about exposing model confidence to the client before deciding; if they're silent, default to keeping it internal-only for this slice (smaller surface change) and note it as a follow-on for a future slice once Focus has UI to do something with it.

---

## 4. Sequencing — two handovers, not one

Do not bundle these into a single Codex prompt. They touch different layers of risk:

**First: `COCKPIT_APPROVAL_LEDGER_COHERENCE_HANDOVER_20260630.md`.** Already complete. Touches `tools/cockpit/projectCockpit.ts` and `tools/ai-gateway.ts` only. Lower risk — UI/process-management layer, not the core engine. Hand this to Codex first, get it merged and validated, before starting the engine work.

**Second: the execution-engine consolidation** (this session's job to finish scoping). Touches `src/engine/executionEngine.ts` directly — the actual execution core used by every Spectra caller, not just the cockpit. Higher risk, needs the verification in §3 done first, and should land as its own isolated PR/branch so a regression here doesn't get conflated with the cockpit UI work.

---

## 5. What the Codex handover for the engine work should contain, once §3 is verified

Follow `prism-beam/templates/CODEX_PROMPT_MINI.md` structure exactly. It should include, at minimum:

- Exact extraction target confirmed in §3.3, with the precise method signature
- Exact confirmation from §3.2 that read-only packets never touch file locks or patches in a way that matters
- The decision from §3.4 on whether `confidenceScore` becomes part of the public response shape
- A note that `lowConfidenceFallbackReason`'s threshold (`this.confidenceThreshold`) should not change — this slice wires Focus into existing cascade logic, it does not retune it
- Explicit instruction: do not touch `runNode`'s call sites elsewhere, do not touch the daemon, do not touch the Workbench — this is additive (give `runAiRequest` access to logic it didn't have), not a removal or behavior change for the graph-execution path
- Test additions: at minimum, a test asserting that a deliberately low-confidence mock Ollama response via `runAiRequest` triggers a fallback to the next tier (mirroring the existing cascade test coverage `runNode` already has in `test/run.ts`), and a test confirming a read-only `docs` packet never acquires a non-trivial file lock or produces a patch
- Validation commands: `npm run typecheck && npm run test:ai-request && npm run test:cockpit` plus the relevant slice of `test/run.ts` covering cascade/fallback (do not need to run the full `npm run test` — it takes long enough to time out in some environments and includes the unrelated daemon e2e failure noted in §0)

---

## 6. Standing-rule recommendation, still not actioned

Both findings this far (cockpit approvals, engine execution path) share one root cause: new work was built without first checking whether Spectra already had a primitive for the same concept. Recommend adding to `prism-beam/ai-guides/REVIEW_FIRST.md`:

> Before introducing a new schema or execution path for any concept resembling approval, audit trail, risk classification, routing, caching, or retry/escalation behavior, search the target repo for an existing suite primitive first (`src/approvals`, `src/events`, `src/capabilities`, `src/engine`, `src/routing` in `prism-spectra`). Use or extend what exists. Only build new if a search genuinely turns up nothing, and say so explicitly in the session output.

This is a recommendation for Dave or a future Beam-maintenance session to action — not something this document or session should do unilaterally, since it modifies Beam's own process docs rather than app source.

---

## 7. Practical housekeeping for the next session

**The three prior-session documents (§0) aren't committed anywhere yet** — they exist only as local chat outputs. `prism-spectra/docs/` already has a precedent for this (`docs/CLAUDE_COCKPIT_UX_AUDIT_HANDOVER.md` from the original cockpit audit is already committed there). Recommend Dave or this session commit the three new documents to `prism-spectra/docs/` following that existing naming pattern, so future sessions can read them directly from the branch instead of relying on re-paste. This also matches Beam's own stated practice: "New findings should be compressed back into Beam rather than forcing future AI sessions to rediscover it" (`current-state.min.md`).

**Update `AI_PROGRESS_LOG.md` in `prism-beam`** using the template at `prism-beam/templates/AI_PROGRESS_ENTRY.md`. A draft entry for the work covered in this handover:

```markdown
### 2026-06-30 — Claude — Cockpit/engine coherence audit and correction scoping

**Task:** Verify GPT's cockpit guided-layer implementation against the live repo; audit
architectural coherence with Spectra's existing suite primitives; scope corrections.

**Files changed or reviewed:**

- `tools/cockpit/projectCockpit.ts` — reviewed; approval-layer correction scoped, not yet implemented
- `tools/ai-gateway.ts` — reviewed; approval-layer correction scoped, not yet implemented
- `src/approvals/queue.ts`, `src/events/ledger.ts` — reviewed; confirmed mature, reusable, unused by cockpit
- `src/capabilities/manifest.ts`, `InMemoryCapabilityRegistry.ts` — reviewed; confirmed scaffold-only, correctly left alone
- `src/workbench/dataSpine.ts`, `ui/workbench/index.html` — reviewed; confirmed Workbench already uses approval/ledger correctly
- `src/engine/executionEngine.ts` — reviewed; found `runAiRequest` does not use cascade escalation or pattern cache that `runNode` already has; not yet fixed

**Outcome:** Two findings, one fully scoped, one partially scoped. (1) Cockpit's bespoke
`CockpitActionPacket` system duplicates the suite's real `ApprovalQueue`/`PrismEventLedger` —
full handover written and ready for Codex. (2) Focus bridge's `runAiRequest` path doesn't use
Spectra's cascade quality-gate or pattern cache, both of which are real, tested, and already
used by `runNode` — finding confirmed, implementation handover not yet written, needs further
source verification (see open items below) before handing to Codex.

**Validation:** Cloned `spectra-project-cockpit-20260629` directly and ran
`npm run test:cockpit` (pass), `npm run typecheck` (pass), `npm run test:ai-request` (pass),
and `test/run.ts` directly (59/60 pass — one unrelated failure, `e2e: daemon execute-graph
and rollback via API`, not investigated, not part of this branch's scope).

**Source/Beam mismatches:** None found in Beam docs themselves. The mismatch was within
`prism-spectra` source — cockpit and engine code drifted from already-documented suite
architecture (`SUITE_AI_ENGINE_BOUNDARY.md`, ADR-010) rather than Beam being stale.

**Risks / cautions:** The engine-level finding touches `src/engine/executionEngine.ts`
directly — the core execution path used by every Spectra caller, not just the cockpit.
Higher risk than the cockpit UI work. Do not bundle the two fixes into one PR/branch.

**Next suggested step:** Complete the three open verification items (trace `runNode`'s
retry loop in full, confirm file-lock/patch steps are no-ops for read-only `docs` packets,
finalize the shared-extraction method shape), then write the Codex handover for the engine
consolidation using `templates/CODEX_PROMPT_MINI.md`.

**Next AI should read:**

- `AI_LOAD_ME_FIRST.md`
- `AI_PROGRESS_LOG.md`
- `prism-spectra/docs/COCKPIT_APPROVAL_LEDGER_COHERENCE_HANDOVER_20260630.md` (once committed)
- This handover document
```

---

## 8. Constraints carried forward from the whole research thread — do not relitigate these

- Do not open a Focus PR from `spectra-project-cockpit-20260629` until local validation is fully clean, including a look at the unrelated daemon e2e failure.
- Do not register cockpit roles in `CapabilityRegistry` — it is scaffold-only (one entry, `'Not implemented'`). Leave it alone.
- Do not merge the Cockpit and Workbench UIs or routes. Their separation is intentional and documented.
- Do not build any shared/persistent store across the cockpit's gateway process and the daemon process. Nothing in Spectra has that yet, for either approvals or the engine's execution state. Don't invent it as a side effect of either fix.
- Do not change the guided panel's one-click approve interaction in the cockpit, and do not change `lowConfidenceFallbackReason`'s threshold in the engine. Both fixes are about wiring existing things together correctly, not redesigning behavior.
- Source code overrides Beam and overrides any prior session's assumptions, including this document's, if something here turns out to be stale by the time you read it. Re-verify against current source before writing the final Codex prompt.
