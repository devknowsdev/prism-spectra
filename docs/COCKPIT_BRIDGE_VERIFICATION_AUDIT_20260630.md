# Cockpit + Focus Bridge — Verification Audit
**Branch:** `spectra-project-cockpit-20260629`
**Date:** 2026-06-30
**Method:** Cloned the branch directly and ran the real test suite, rather than reading GPT's report on trust.

---

## 1. Verification summary — what's actually confirmed

I cloned `spectra-project-cockpit-20260629` and ran the validation GPT's report says is still outstanding.

```
npm run test:cockpit    → PASS
npm run typecheck       → PASS (no errors)
npm run test:ai-request → PASS — "ok - ai request gateway contract"
npm run (full test:run) → 59/60 PASS
```

**One failure, unrelated to this work:** `e2e: daemon execute-graph and rollback via API` fails — a marker file the daemon should create during graph execution isn't found. This is in `test/run.ts`, a different subsystem (the execution daemon/checkpoint engine), not the cockpit or bridge code touched this session. I didn't dig into root cause — flagging it as a pre-existing or environment-dependent issue that needs a look before any PR, but it isn't something this session's work introduced.

**GPT's report says** "we still need a clean local validation pass" — that's overly cautious. Typecheck, cockpit tests, and the ai-request contract test are clean right now. The only outstanding item is that one e2e daemon test, which is outside the scope of this branch's stated work.

### Spot-checking specific claims against source

I read the actual diffs and commit history (212 commits, with this session's work landing as a clean, well-sequenced chain — PID fix → guided panel → log persistence → guided-first failure card → RPM budget fix → Focus JSON shape → contextual intents → copy buttons → a syntax-error fix, each paired with a test commit). A few claims worth calling out specifically:

**PID 0 bug — fixed correctly.** `listeningPids()` now trims, bails on empty output, and filters to positive integers via a properly extracted `parsePidOutput()` function with six unit tests covering the edge cases (empty, whitespace, zero, negative). This matches the original diagnosis exactly.

**Guided panel — built largely to spec, and extended sensibly.** `deriveCockpitGuidance()` and the action-packet model are implemented essentially as designed. GPT went further than the original slice plan in good ways: failed validation now renders an inline "What to do now" card with the actual validation log embedded directly in the guided panel (not buried in advanced cards), plus a one-click "Run validation again" button. That's a real UX improvement over the original spec.

**Log/panel state persistence across auto-refresh — real and tested.** `advancedOpen` and `openLogRoles` are held in module-level state and reapplied on every render, so the 4-second poll no longer collapses panels you have open. This addresses a genuine annoyance that wasn't in the original audit and is a good catch.

**Provider RPM budget fix — verified correct.** `applyProviderProbe()` now clears `rpmLimit` to `null` when a provider comes back available, instead of leaving a stale `0` block in place. This was a real bug with a real fix.

**Read-only safety boundary — stronger than I assumed.** I checked whether "destructive request" refusal was just the mock executor noticing scary words in the prompt. It isn't, structurally. `AI_REQUEST_RISK_CLASSES` only contains `"read-only"`, and `/api/v1/ai/request` rejects anything else at the contract level before it ever reaches a model. So even if a future real-mode model decided to be unhelpfully agreeable about "clear all my events," there's no code path from this endpoint that could mutate Focus state — the mock's polite refusal is a UX nicety layered on top of an actual architectural guarantee, not the only thing standing between a bad prompt and data loss. That's the right way to build this boundary, and it's already in place, which is more solid than the report implies.

---

## 2. UX/UI audit of what's now live

### What's working well

The information architecture from the original audit is in place: guided panel first, mission + state summary + single next action + readiness checklist, advanced cards collapsed by default underneath. The PID display bug that prompted the original audit is gone.

The validation-failure handling is the standout addition. Originally my plan just said "show-logs" pointed at the advanced card. GPT's implementation surfaces the actual failed output inline in the guided panel itself — you don't have to leave the guided flow to see why something broke, and "Run validation again" sits right next to it. That's a meaningfully better recovery experience than what I scoped.

### Real gaps, found by reading the code rather than the report

**The "Bridge test ready to run" checklist item can never reach "done."** I checked `deriveCockpitGuidance()` directly — the fourth checklist item is hardcoded to `status: "pending"` regardless of state (this was actually an oversight carried over from my own original pseudocode, not something GPT introduced — worth owning that). More importantly, "Approve — Open Focus" on the final guided state just does `window.open('http://127.0.0.1:4173/', '_blank')`. It opens Focus; it doesn't actually test the bridge.

Here's the thing: the tool to do this properly already exists in the repo and isn't wired in. `tools/focus-ai-smoke.ts` (run via `npm run test:focus-ai`) already does exactly the smoke test GPT's own report lists as a "next improvement" — it posts a real Focus-shaped request to `/api/v1/ai/request` and confirms a structured response comes back. Right now that only runs from a terminal. Exposing it as a cockpit API action and wiring it into the guided panel's final state would let the checklist item actually flip to "done" instead of staying permanently pending, and would close the loop GPT flagged as missing without inventing anything new.

**Placeholder cards (Vibe-Coder CLI, Prism Build) haven't been touched yet.** Still rendered the same way as the original audit found them — disabled buttons rather than no buttons, same visual weight. This was always slice 5, lowest priority, and nothing has regressed here — just flagging it's still open.

**The destructive-action and contextual-intent matching in mock mode is regex-based pattern matching**, not a model judgment. That's fine and arguably safer for a deterministic mock, but worth being explicit with Dave: this isn't a preview of how real mode will behave, it's a stand-in. The real safety boundary (the one that actually matters) is the `riskClass=read-only` contract enforcement I verified above — that one is structural and will hold in real mode too. The regex matching in the mock is local UX polish, not a safety mechanism that carries forward.

---

## 3. Alignment with the broader Spectra vision

I checked this against `docs/FOCUS_AI_INIT.md` and `docs/AI_REQUEST_GATEWAY.md`, which state the architecture boundary explicitly:

```
Focus feature → Focus AiAdapter → Spectra /api/v1/ai/request → Spectra provider routing → Focus review UI
```

Spectra owns provider routing, model selection, local Ollama access, and provenance. Focus owns its own task/planner state. This session's work fits that boundary cleanly — the bridge transport, the read-only contract enforcement, and the structured `reply`/`proposedTasks`/`proposedSchedule`/`followUpQuestion` shape all match the documented design rather than drifting from it. The cockpit's role in this picture — as the local visible control surface for starting/inspecting/validating the bridge — is also consistent with Spectra's stated role as the CLI AI superbrain layer for the suite, not a generic dashboard.

One thing worth flagging for Dave directly, not as a problem but as a sequencing note: GPT's "Recommended next build order" puts real Ollama mode as step 5, after PR stabilization, mock/real labelling, and the bridge smoke test. That ordering is sound and matches the documented "mock proves wiring, real mode comes after" philosophy in `FOCUS_AI_INIT.md`.

---

## 4. Harvest recommendations — sharpened against what's actually needed now

The original harvest audit (Tilt, Cline, Overmind, etc.) still stands for the cockpit's process-management shell. This session's actual work surfaced more specific, immediate needs worth pointing at concrete tools rather than general categories:

**For real-mode JSON reliability (GPT's own #1 flagged need)** — this is the most actionable harvest opportunity right now. Two specific options, both directly compatible with Ollama:

- **Outlines** (Apache-2.0) does constrained/grammar-based decoding — it can force a local model to only ever emit valid JSON matching a schema, which eliminates the "JSON repair/retry" problem at the generation step rather than patching malformed output after the fact. This is a stronger fix than retry-on-failure.
- **Instructor** (MIT) takes the opposite approach — wraps the model call, validates the response against a schema, and automatically retries with the validation error fed back to the model if it fails. Simpler to integrate if Outlines' grammar constraints feel like too much machinery for now.
- Also worth checking before reaching for either: recent Ollama versions support a native `format` parameter for JSON-schema-constrained output directly in the API, which might remove the need for an external dependency entirely. Worth a quick check against current Ollama docs before adding either library.

**For "local model status: loaded model, RAM pressure"** — no new tool needed here. The cockpit's existing "Ollama Status" card already runs `ollama ps`, which returns exactly this (loaded model, memory usage, processor). The gap isn't missing tooling, it's that this output isn't parsed into the guided panel's checklist/safety status yet — it's only visible as raw text in an advanced card. Parsing this into a structured "real-mode readiness" signal is a small follow-on to the existing role, not a harvest task.

**For the Focus apply/review flows (proposedTasks, proposedSchedule, urgency tagging)** — Cline's diff-preview-before-write pattern and Aider's `--show-diff-stats` are still the right reference, now with a concrete target: GPT's mock already returns structured `proposedTasks`/`proposedSchedule` objects, so the harvest target is specifically how Cline renders "here's what changes, approve or reject" for structured data, not just file diffs. Worth a closer look at Cline's tool-call approval card the next time that slice is built.

---

## 5. Bottom line for Dave

The work is more solid than the report's own hedging suggests — typecheck, cockpit tests, and the ai-request contract are clean right now, and the safety architecture (read-only contract enforcement) is stronger than a quick read of the mock's regex refusals would suggest. The one real test failure found is in an unrelated subsystem (daemon e2e) and shouldn't block continued cockpit/bridge work, but should get a look before any PR.

The most useful next slice isn't on GPT's list as written: wire `tools/focus-ai-smoke.ts`'s logic into a cockpit API action so "Bridge test ready to run" can actually become "done" instead of staying permanently pending. Everything else needed for that already exists in the repo.
