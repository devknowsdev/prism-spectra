# Master Build Plan — Spectra Cockpit, Engine Coherence, and the Real-Mode Focus JSON Bug

**For:** GPT (implementation executor)
**From:** Claude session, 2026-06-30 (sweep of three prior handovers + full source verification)
**Branches touched:** `prism-spectra:spectra-project-cockpit-20260629` (primary), `prism-focus:spectra-focus-ai-init-20260627` (read-only reference for P0 diagnosis)
**Status of this document:** Supersedes the three documents listed in §0 as the single entry point. Do not discard them — they contain implementation-level detail this document summarizes rather than repeats.

---

## 0. What this document is

Dave asked Claude to read three prior-session documents (`COCKPIT_BRIDGE_VERIFICATION_AUDIT_20260630.md`, `COCKPIT_APPROVAL_LEDGER_COHERENCE_HANDOVER_20260630.md`, `CLAUDE_CONTINUATION_HANDOVER_20260630.md`) and check whether anything was missed. Two things came out of that:

1. **Every open verification item the continuation handover left for a future session has now been completed** by reading the actual source on the `spectra-project-cockpit-20260629` branch — `src/engine/executionEngine.ts`, `src/executors/ollama.ts`, `src/executors/aiPrompt.ts`, `src/approvals/queue.ts`, `src/events/ledger.ts`, `tools/cockpit/projectCockpit.ts`. The engine-consolidation Codex handover that was blocked on verification can now be written. See §3.

2. **A fourth, more urgent bug was found that none of the three documents mention**, and it directly explains an item Beam has flagged as unresolved with no diagnosis: `prism-beam/context-packs/workspace/current-state.min.md` lists *"Fix or clarify empty real-mode response handling before opening the Focus PR"* as next work, with no root cause given. The root cause is now known, confirmed by reading both sides of the bridge (Spectra's executor and Focus's actual chat call site). This is currently the single biggest blocker to a working real-mode Focus integration, and it's a self-contained, low-risk fix. See §1 — **do this first.**

Priority order for this session:

```
P0  — Real-mode Focus JSON bug                  (§1)  — new finding, unblocks Focus PR, low risk
P1  — Cockpit approval/ledger coherence fix      (§2)  — already fully scoped, verified still accurate, low risk
P2  — Engine cascade/cache consolidation         (§3)  — verification now complete, higher risk, isolated PR
P3  — aiRole/maxOutputTokens structural fragility (§4)  — fold into the P2 PR, same files
P4  — Housekeeping                               (§5)
```

Do not bundle P0–P3 into one PR. Each is independently isolatable and they touch different risk tiers, matching the "don't bundle" principle the continuation handover already established for P1/P2.

---

## 1. P0 — Real-mode Focus chat returns no usable structured reply

**Severity:** High. This is currently blocking real-mode validation of the Focus↔Spectra bridge (`current-state.min.md`: *"gateway health/token/CORS pass and `qwen3.5:9b` loads, but Focus receives empty usable response text from the real chat path"*).

**Confidence:** High on the root cause below (traced through source on both repos, not inferred). One secondary contributing factor is flagged as plausible-but-unverified — see §1.3.

### 1.1 What Focus actually sends

`prism-focus/src/ai_chat_spectra_bridge.js` (the real chat call site — not the older generic `ai_spectra_bridge.js`/`aiCallJson` path, which is unused for chat) sends:

```js
window.AiAdapter.aiRequest({
  sourceApp: 'prism-focus',
  intent: 'focus-chat-message',
  riskClass: 'read-only',
  preferredMode: 'local-first',
  aiRole: 'planner',
  input: {
    prompt: text,
    history,
    instruction: FOCUS_ASSISTANT_INSTRUCTION,   // ← see below
    currentFocusState: { ... },
  },
  context: {
    feature: 'focus-chat',
    conversationId: convId,
    appSurface: 'chat-modal',
    allowedCapabilities: [...],
    disallowedCapabilities: [...],
  },
})
```

`FOCUS_ASSISTANT_INSTRUCTION` (`prism-focus/src/ai_spectra_assistant_instruction.js`) is a real, complete system prompt. It ends with:

```
Return ONLY valid JSON with this shape:
{
  "reply": "short helpful response shown to the user",
  "proposedTasks": [...],
  "proposedSchedule": [...],
  "followUpQuestion": "..."
}
```

This is a well-designed instruction. The bug is not in Focus's request — it's in how Spectra's real executor handles it.

### 1.2 What Spectra's real path does with it — the bug

`runAiRequest()` (`src/engine/executionEngine.ts`) builds a `TaskPacket` where `request.input` (containing `instruction: FOCUS_ASSISTANT_INSTRUCTION`) ends up nested at `packet.context.aiRequest.input.instruction`.

`OllamaExecutor.execute()` (`src/executors/ollama.ts`) builds the prompt sent to the real model via `buildTaskPrompt()` (`src/executors/aiPrompt.ts`):

```ts
export function buildTaskPrompt(packet: TaskPacket, requestedFiles: string[]): string {
  const lines = [`Task type: ${packet.node_type}`, `Intent: ${packet.intent}`];
  if (packet.constraints.length) lines.push(`Constraints: ${packet.constraints.join("; ")}`);
  const context = { ...packet.context };
  delete context.targetFile; delete context.targetFiles; delete context.simulateFailure;
  delete context.cwd; delete context.command; delete context.validate;
  if (Object.keys(context).length) lines.push(`Context: ${JSON.stringify(context)}`);

  if (requestedFiles.length > 0) {
    lines.push(/* file-block format instructions */);
  } else {
    lines.push("Respond concisely with the result only.");   // ← this line
  }
  return lines.join("\n");
}
```

For a Focus chat request, `requestedFiles.length === 0` (no `targetFile`/`targetFiles` set), so the function takes the `else` branch. The result:

- `FOCUS_ASSISTANT_INSTRUCTION` — including the explicit "Return ONLY valid JSON" line and the full schema — is never surfaced as an instruction. It's buried as inert text several levels deep inside a single `Context: { ...giant JSON dump... }` line.
- The actual final instruction the model sees is **"Respond concisely with the result only,"** which says nothing about JSON and effectively competes with the buried instruction.
- The real model (`qwen3.5:9b`) therefore responds in natural prose, not JSON.

Downstream, `parseStructuredResponse()` (`src/engine/aiRequest.ts`) tries `JSON.parse`, then a fenced-code-block match, then an embedded-braces regex — all fail against plain prose — so `structuredResponse: null` is returned to Focus.

On the Focus side, `ai_chat_spectra_bridge.js` does:

```js
const raw = result.structuredResponse || _extractSpectraText(result);   // falls through to result.response (plain prose)
const payload = _parseAssistantPayload(raw);                            // JSON.parse fails on prose → { reply: <the raw prose>, proposedTasks: [], proposedSchedule: [] }
```

So the chat bubble doesn't literally render empty — it renders the model's raw, unstructured prose as `payload.reply`, and `proposedTasks`/`proposedSchedule` are always empty in real mode. Whether this reads to Dave as "empty usable response" likely depends on what the model's raw prose actually contains in practice (which may include leftover reasoning-style text — see §1.3) — but either way, **the core Focus value proposition (structured task/schedule proposals from chat) is completely non-functional in real mode**, silently, with no error surfaced anywhere.

**Why mock mode looked fine and hid this:** `OllamaMockExecutor` (`src/executors/ollamaMock.ts`) has bespoke `focusJsonAiRequest()`/`mockOutputFor()` logic that detects `context.feature === 'focus-chat'` (or an instruction containing "Return ONLY valid JSON"/"proposedTasks") and hand-synthesizes a correctly-shaped JSON reply directly — bypassing `buildTaskPrompt()` entirely. This is good, deliberate mock design (per `AI_PROGRESS_LOG.md`, 2026-06-29: *"GPT fixed mock-mode Focus chat shape"*), but it means the real path was never given an equivalent fix. This is the same category of drift the cockpit-approvals and engine-cascade findings already identified — a new/special path built without extending what governs the general case — just in a third location (prompt construction) that nobody had connected to the unresolved Beam item yet.

### 1.3 Secondary, unverified-but-plausible contributing factor

Nothing in the real-mode call path sets `think: false` or a `thinking.budget_tokens` cap on the Ollama request, and `qwen3.5:9b` is a thinking-capable model with reasoning-mode behavior. If a future caller sets `maxOutputTokens` low (the field exists and is plumbed through — see §4), a verbose internal reasoning trace could consume the token budget before any visible answer is emitted, producing genuinely truncated/empty-looking output independent of the JSON bug above. Worth checking once §1.4's fix is in, but do not treat as confirmed — flag it, don't build a fix for a problem that hasn't been reproduced.

### 1.4 The fix

This is also exactly the gap the prior verification audit's harvest section (§4, "For real-mode JSON reliability — GPT's own #1 flagged need") already pointed at — Outlines, Instructor, or Ollama's native `format` parameter — without anyone realizing this was the active bug behind Beam's unresolved item. Use that research:

1. **Primary fix — Ollama's native JSON-schema-constrained `format` parameter.** Check the installed Ollama version supports `format` as either `"json"` or a full JSON-schema object in the `/api/chat` request body (recent Ollama versions do — verify against current docs before assuming). Add a way for `OllamaExecutor.execute()` to detect a Focus/JSON-expecting request (e.g. `packet.context.aiRequest?.context?.feature === 'focus-chat'`, or more generally `packet.context.aiRequest?.context?.responseFormat === 'json'` if that signal is added — see below) and pass the matching `format` value. This is the most reliable fix and needs no new dependency — it's one additional field in the existing `fetch()` call.

2. **Surface the instruction, don't bury it.** Regardless of whether `format` constraining is available, `buildTaskPrompt()` (or a new Focus-specific prompt path) should pull `packet.context.aiRequest.input.instruction` out and place it as the *primary* instruction in the prompt — not nested inside a JSON-dumped `Context:` blob — and the generic closing line "Respond concisely with the result only" should not be appended when an explicit instruction is already present. Treat this as belt-and-suspenders alongside `format` constraining, not a replacement for it: model JSON-following without schema constraints is not perfectly reliable even with a clear instruction.

3. **Add a `responseFormat` signal at the packet level**, not just buried in `context.aiRequest.context.responseFormat`. Right now Focus's `aiCallJson()` path does set `context.responseFormat`, but the chat-specific call site (`ai_chat_spectra_bridge.js`, the one that actually matters here) doesn't set it explicitly — it relies on `context.feature === 'focus-chat'` plus the instruction text. Pick one consistent, structural signal (recommend: a top-level `packet.context.expectsJson: boolean` or `packet.context.responseSchema: object`, set explicitly by `runAiRequest()` when `request.context?.feature` matches a known JSON-expecting Focus feature, or when `request.input?.instruction` is present) and have both the `format` decision and the prompt-surfacing decision in (1) and (2) key off that single signal — not three different heuristics scattered across mock/real/Focus code as exists today.

4. **Test:** add a test in `test/ai-request.test.ts` (or wherever Ollama-executor-level tests live) asserting that a `focus-chat`-shaped packet produces a Ollama request body containing the `format` field, and that `buildTaskPrompt()`'s output for such a packet contains the literal instruction text rather than only a JSON-dumped context blob. This can be tested without a live Ollama server — assert on the constructed request/prompt, not on model output.

5. **Do not change** `OllamaMockExecutor`'s existing behavior — it's correct and already tested. Do not change the Focus-side `ai_chat_spectra_bridge.js` or `FOCUS_ASSISTANT_INSTRUCTION` — Focus's request is well-formed; the bug is entirely on the Spectra executor/prompt side.

**Validation:** `npm run typecheck && npm run test:ai-request`. Manual validation needs real Ollama running (`AI_FORGE_MOCK_EXECUTORS=0 npm run ai:gateway`) and a real Focus chat message — confirm `structuredResponse` is non-null and `proposedTasks`/`proposedSchedule`/`reply` are populated as expected, then update `current-state.min.md`'s "Next likely work" line to reflect this is fixed (see §5).

---

## 2. P1 — Cockpit approval/ledger coherence correction

**Source:** `COCKPIT_APPROVAL_LEDGER_COHERENCE_HANDOVER_20260630.md` (uploaded document, full implementation detail there — not repeated here).

**Status of this document's claims:** Spot-checked against current branch source — `src/approvals/queue.ts`, `src/events/ledger.ts`, `src/capabilities/manifest.ts`, `tools/cockpit/projectCockpit.ts`, `tools/ai-gateway.ts`, `src/workbench/dataSpine.ts` all exist and match the interfaces the handover describes. **No drift since it was written. Ready to hand to Codex as-is.**

**One-line summary:** The cockpit's guided-panel approval flow (`CockpitActionPacket`, flat `risk` field) was built from scratch without checking that Spectra already has a mature `ApprovalQueue`/`PrismEventLedger` pair (`src/approvals`, `src/events`), already used correctly by the Workbench. The fix replaces the cockpit's bespoke system with the real one — narrow, additive, no UX change, no new persistence layer (both classes are in-memory today, matching how the Workbench already uses them).

This should land before any further cockpit feature work, per the handover's own severity note. It's lower risk than P2/P3 (UI/process-management layer, not the core engine) and fully scoped — hand it to Codex directly using the file-by-file implementation in that document.

---

## 3. P2 — Engine cascade/cache consolidation

**Source:** `CLAUDE_CONTINUATION_HANDOVER_20260630.md` §2–§5 for the original finding and intended shape. This section completes the four verification items that document left open (§3.1–§3.4 there), so the Codex handover can now actually be written.

### 3.1 The finding (confirmed, unchanged from the continuation handover)

`runAiRequest()` — the method the Focus bridge actually calls — does a single `route()` → `executeViaRoute()` and returns. It never calls `lookupCache()` (exact + semantic pattern cache) and never calls `lowConfidenceFallbackReason()` (the cascade escalation check). `runNode()` — the graph-execution method everything else uses — does both, correctly, with test coverage. ADR-010's documented cascade architecture (route → execute → quality-gate → escalate-on-low-confidence) is real, built, and tested, but unreachable from the endpoint Focus actually calls.

### 3.2 Verification item 1 — `runNode`'s retry loop, traced in full

```ts
const cacheable = packet.node_type !== "terminal";
const cacheLookup = cacheable ? await this.lookupCache(packet) : { hit: false };

if (cacheLookup.hit) {
  result = { /* built directly from cache, no route/execute, no recordUsage call */ };
} else {
  let decision = await this.route(packet);
  chainTried = decision.chainTried;
  routeCacheHit = decision.routeCacheHit;
  routeCacheSimilarity = decision.routeCacheSimilarity;

  if (!decision.executor) {
    result = { success: false, ... };
  } else {
    const tried: ExecutorName[] = [];
    result = await this.executeViaRoute(packet, decision.executor);

    while (this.fallbackOnFailure && decision.executor) {
      const lowConfidenceReason = this.lowConfidenceFallbackReason(result);
      if (result.success && !lowConfidenceReason) break;            // happy path

      tried.push(decision.executor);
      decision = await this.route(packet, tried);                   // exclude already-tried executors
      chainTried = [...(chainTried ?? []), ...decision.chainTried];  // accumulate
      routeCacheHit = routeCacheHit || decision.routeCacheHit;       // OR-accumulate
      routeCacheSimilarity = routeCacheSimilarity ?? decision.routeCacheSimilarity; // keep first
      if (!decision.executor) break;
      const retry = await this.executeViaRoute(packet, decision.executor);
      result = { ...retry, fallbackReason: ..., error: ... };        // merge
    }

    this.ledger.recordUsage(result.provider, { cost: result.cost }); // only on cache-miss branch
  }
}
```

Key behavior to preserve in extraction: `recordUsage` fires exactly once, only when there was no cache hit (cache hits cost nothing — correctly skipped). `chainTried`/`routeCacheHit`/`routeCacheSimilarity` accumulate across every retry iteration, not just the first attempt. This state threading must be preserved exactly by any shared extraction.

### 3.3 Verification item 2 — read-only `docs` packets never touch file locks or produce patches

Confirmed, and more strongly than the continuation handover assumed — this isn't just empirically true today, it's structurally guaranteed by how the types fit together:

- `FileLockManager.acquire()` (`src/engine/fileLock.ts`) is explicitly documented: *"Empty/undefined paths = no-op."* `runAiRequest()`'s packet construction never sets `filePaths` at all, so `packet.filePaths` is `undefined` — the no-op path, by construction, not by accident.
- `collectTargetFiles()` (`src/executors/aiPrompt.ts`) reads `packet.context.targetFile`/`packet.context.targetFiles`. `runAiRequest()`'s packet places `request.context` at `packet.context.aiRequest.context` (nested), never at the top-level `packet.context.targetFile`/`targetFiles` keys `collectTargetFiles()` actually checks. So `requestedFiles.length` is always `0` for ai-request-originated packets — not just for the current Focus call shape, but for *any* caller of `runAiRequest()`, because the packet-construction code path itself never threads a `targetFile` field through.
- `OllamaExecutor.execute()` only produces a `patch` field when `requestedFiles.length > 0` (confirmed in §1.2/§4 source). Since that's structurally always `0` for `runAiRequest()`, **a patch can never be produced via this endpoint**, regardless of model output content.

This means a shared extraction that includes the cache-lookup path (`cacheLookup.originPatch`) is safe for `runAiRequest()`'s read-only contract — there is no patch to leak, by construction, not by today's behavior happening to be safe.

### 3.4 Verification item 3 — extraction shape

Confirmed feasible. Recommended signature:

```ts
private async executeWithCascade(
  packet: TaskPacket,
  opts: { cacheable: boolean }
): Promise<{
  result: ExecutionResult;
  chainTried?: ChainAttempt[];
  routeCacheHit?: boolean;
  routeCacheSimilarity?: number;
  cacheHit: boolean;
}>
```

This method contains exactly the block traced in §3.2 (cache lookup → route → execute → confidence-check/retry loop → conditional `recordUsage`). `runNode()` keeps everything *outside* that block as its own responsibility — file lock acquisition, patch application, checkpointing, validation, pattern-cache writes, learning-loop recording, conversation-message recording — since none of that generalizes to `runAiRequest()`'s read-only contract and shouldn't be forced into a shared method. `runAiRequest()` calls `executeWithCascade(packet, { cacheable: true })` (ai-request packets are always cacheable per §3.3) and wraps the result directly into `AiRequestSuccess`/`AiRequestFailure`, including a `cacheHit`/`cacheHitKind` field if useful for provenance (optional, not required).

No genuine divergence found that would block this extraction — the continuation handover's concern in §3.3 (*"if runNode's patch-handling genuinely can't be separated cleanly... say so"*) does not apply; patch-handling already lives entirely outside the loop being extracted.

### 3.5 Verification item 4 — should `confidenceScore` be exposed in `AiRequestSuccess`?

Resolved. Both `docs/FOCUS_AI_INIT.md` and `docs/AI_REQUEST_GATEWAY.md` are silent on confidence scoring — neither mentions it, and the documented response shape example in `AI_REQUEST_GATEWAY.md` doesn't include it. Per the continuation handover's own stated default ("if they're silent, default to keeping it internal-only for this slice"): **keep `confidenceScore` internal-only.** Use it to decide escalation, do not add it to `AiRequestSuccess`/`AiRequestFailure`. Note for a future slice: `NodeRunLog` (the `runNode` return type) already exposes `confidenceScore` as precedent, so there's no architectural reason it couldn't be added to the AI-request response shape later if Focus ever builds UI for it — just not in this slice.

### 3.6 What this PR should contain

- `executeWithCascade()` extraction per §3.4, in `src/engine/executionEngine.ts`.
- `runNode()` refactored to call it, preserving identical behavior (this should be a refactor with no behavior change for the graph-execution path — the existing `test/run.ts` cascade/cache test coverage must still pass unmodified).
- `runAiRequest()` refactored to call it instead of its current single `route()`/`executeViaRoute()` pair.
- Do not change `lowConfidenceFallbackReason`'s threshold (`this.confidenceThreshold`) — this is wiring, not retuning.
- Do not touch the Workbench, the daemon, or any other `runNode()` call site beyond the refactor itself.
- Test additions: a test asserting a deliberately low-confidence mock Ollama response via `runAiRequest` triggers fallback to the next tier (mirroring `runNode`'s existing cascade test coverage in `test/run.ts`), and a test confirming a read-only `docs` packet via `runAiRequest` never acquires a non-trivial file lock or produces a patch (this can now cite §3.3's structural guarantee directly in the test's comment).
- Validation: `npm run typecheck && npm run test:ai-request && npm run test:cockpit` plus the cascade/cache slice of `test/run.ts`. Full `npm run test` is not required (the pre-existing unrelated `e2e: daemon execute-graph and rollback via API` failure remains out of scope — see §5).

---

## 4. P3 — `aiRole`/`maxOutputTokens` regex-fallback fragility

**New finding, fold into the P2 PR (same files, same session of focus).**

`AiRequestInput.aiRole` and `AiRequestInput.maxOutputTokens` are real, documented, client-settable fields (`src/engine/aiRequest.ts`). `buildAiRequestIntent()` embeds them into the `intent` string as JSON text — but `runAiRequest()`'s packet construction never threads them into `packet.context.aiRequest.{aiRole,maxOutputTokens}` directly. The *only* way they currently reach the executor is via regex-parsing the JSON-stringified intent string back out again:

```ts
// src/executors/ollama.ts
function aiRoleFromIntent(intent: string): string | null {
  const match = intent.match(/"aiRole"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? null;
}
function maxOutputTokensFromIntent(intent: string): number | null {
  const match = intent.match(/"maxOutputTokens"\s*:\s*(\d+)/);
  return match ? Number(match[1]) : null;
}
```

This works today only because `buildAiRequestIntent()`'s JSON formatting happens to match these regexes. It is not a structural guarantee — any future change to how `buildAiRequestIntent()` serializes the payload (key renaming, different stringify options, a refactor unrelated to routing) would silently break role/token-cap selection with no test failure and no error, since both functions return `null` on a non-match and callers fall back silently to defaults.

**Fix:** in `runAiRequest()`'s packet construction, set `packet.context.aiRequest.aiRole` and `packet.context.aiRequest.maxOutputTokens` directly from `request.aiRole`/`request.maxOutputTokens`, matching the structured-field pattern `modelRoleFromPacketContext()` already prefers over the intent-regex fallback. Keep the regex functions as a legacy fallback only (do not remove — `runNode()`-originated packets elsewhere in the codebase may still rely on intent-embedded routing hints), but the ai-request path should no longer depend on it. Same files as P2 (`executionEngine.ts`), no separate PR needed.

---

## 5. P4 — Housekeeping

1. **Commit the prior-session documents.** None of the three uploaded documents, nor this one, exist anywhere in either repo yet — confirmed by checking `prism-spectra/docs/` on both `main` and the `spectra-project-cockpit-20260629` branch. (`CLAUDE_COCKPIT_UX_AUDIT_HANDOVER.md`, the original cockpit audit referenced as precedent, *is* already committed on the branch — confirming the naming convention to follow.) Commit all four documents to `prism-spectra/docs/` on the cockpit branch:
   - `CLAUDE_COCKPIT_UX_AUDIT_HANDOVER.md` (already there)
   - `COCKPIT_BRIDGE_VERIFICATION_AUDIT_20260630.md`
   - `COCKPIT_APPROVAL_LEDGER_COHERENCE_HANDOVER_20260630.md`
   - `CLAUDE_CONTINUATION_HANDOVER_20260630.md`
   - This document — suggest `GPT_BUILD_PLAN_COCKPIT_ENGINE_FOCUS_JSON_20260630.md`

2. **Update `current-state.min.md`'s "Next likely work" section.** Replace *"Fix or clarify empty real-mode response handling before opening the Focus PR"* with a pointer to §1 of this document and a one-line root-cause summary, so a future session doesn't have to re-diagnose it.

3. **Update ADR-010's status framing.** ADR-010 was drafted assuming Tier 2b through Tier 3c were entirely unbuilt. Per `AI_PROGRESS_LOG.md`, they are now merged to `main` (PRs #25–#29). ADR-010 itself remains architecturally accurate (it correctly predicted the cascade-as-fallback shape that was actually built), but its "Build order" / status section should be updated to reflect what's now live versus what this document's P2/P3 still need to wire (`runAiRequest` access to that already-built intelligence).

4. **Action the standing-rule recommendation**, now reinforced by a third independent instance of the same root cause (cockpit approvals reinvented a primitive; engine execution reinvented a sequence; prompt construction silently dropped a real instruction rather than extending the shared prompt builder to handle it). Add to `prism-beam/ai-guides/REVIEW_FIRST.md`:

   > Before introducing a new schema, execution sequence, or prompt-construction special-case for any concept that already has a general-purpose handler in the target repo, search for and extend the existing one first (`src/approvals`, `src/events`, `src/capabilities`, `src/engine`, `src/routing`, `src/executors` in `prism-spectra`). This applies to mock-vs-real parity too — if mock mode needed bespoke logic to produce a correct shape, check whether the real path needs the equivalent logic, not just a different one.

5. **Update `AI_PROGRESS_LOG.md`** with an entry once P0–P3 land, following the existing entry format in that file (see the 2026-06-29 entries for the house style — root cause, changes, commits, validation).

---

## 6. What stays exactly as it is — carried forward from the continuation handover, still applies

- Do not register cockpit roles in `CapabilityRegistry` (scaffold-only).
- Do not merge the Cockpit and Workbench UIs or routes.
- Do not build any shared/persistent store across the cockpit gateway process and the daemon process.
- Do not change the guided panel's one-click approve interaction.
- Do not change `lowConfidenceFallbackReason`'s threshold.
- Do not touch `runNode`'s call sites elsewhere, the daemon, or the Workbench as a side effect of P2/P3.
- Source code overrides this document and every document it references if something has changed by the time you read it — re-verify before implementing, especially for P0 where Ollama's exact `format`-parameter support should be checked against current docs rather than assumed.
