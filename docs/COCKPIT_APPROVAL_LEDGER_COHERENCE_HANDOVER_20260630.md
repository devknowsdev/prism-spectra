# Correction — Cohere Cockpit Actions with Spectra's Existing Approval/Ledger System

**Branch:** `spectra-project-cockpit-20260629`
**Date:** 2026-06-30
**Type:** Architecture correction, not a new feature
**Severity:** Should land before any further cockpit feature work, including the bridge-smoke-test wiring discussed previously

---

## 0. What happened and why this document exists

During the cockpit guided-layer build, a new "propose an action, explain the risk, get approval" system was designed and implemented (`CockpitActionPacket`, `CockpitActionKind`, flat `risk: "none"|"low"|"medium"`). This was built from scratch, in isolation, without checking whether Spectra already had a primitive for this. It did — `src/approvals/queue.ts` and `src/events/ledger.ts` — fully implemented, tested, and already in production use by the Spectra Workbench (`tools/daemon.ts` → `/workbench`, 3,043 lines, backed by `src/workbench/dataSpine.ts`).

This document corrects that. The fix is narrow: replace the cockpit's bespoke approval concept with the suite's real one. It does **not** touch the guided-panel UX, does **not** touch the Workbench, and does **not** require building any new persistence layer.

**Standing rule going forward, worth adding to Beam's `REVIEW_FIRST.md`:** before introducing a new schema for any concept that looks like approval, audit trail, risk classification, or state tracking, search the relevant repo for an existing suite primitive first (`src/approvals`, `src/events`, `src/capabilities` in `prism-spectra`). Use or extend what exists. Only build new if a search genuinely turns up nothing. This is a recommendation for Dave to fold into Beam's process docs in the next Beam session — not something this document does on its own.

---

## 1. What already exists (verified directly against source, not assumed)

### `src/approvals/queue.ts` — fully implemented, not a stub

```typescript
export const approvalStatuses = ["pending", "approved", "rejected", "cancelled", "expired"] as const;
export const approvalLocalRemoteBoundaries = ["local-only", "remote-optional", "remote-required"] as const;

export interface ApprovalRequestInput {
  id?: string;
  title: string;
  summary: string;
  approvalClass: CapabilityApprovalClass;       // from src/capabilities/manifest.ts
  checkpointPolicy: CapabilityCheckpointPolicy;  // from src/capabilities/manifest.ts
  relatedCapabilityId?: string;
  relatedArtifactIds: string[];
  relatedFilePaths: string[];
  previewAvailable: boolean;
  previewSummary?: string;
  cliEquivalent?: string;          // ← this is literally the cockpit's commandPreview field
  riskNotes: string[];             // ← richer than the cockpit's single risk string
  localRemoteBoundary: ApprovalLocalRemoteBoundary;
  requestedBy: string;
}

export class InMemoryApprovalQueue implements ApprovalQueue {
  constructor(private readonly ledger?: PrismEventLedger) {}
  requestApproval(input: ApprovalRequestInput): ApprovalRequest { /* writes to ledger automatically */ }
  listApprovals(options?: ApprovalListOptions): ApprovalRequest[] { /* ... */ }
  getApproval(id: string): ApprovalRequest | undefined { /* ... */ }
  resolveApproval(id: string, decision: ApprovalDecision): ApprovalRequest { /* writes to ledger automatically */ }
  clear(): void { /* ... */ }
}
```

Both `requestApproval()` and `resolveApproval()` already call `this.ledger?.append(...)` internally — wiring the cockpit into this gets a correct audit trail for free, with zero additional ledger-writing code needed in the cockpit itself.

### `src/capabilities/manifest.ts` — the approval taxonomy to use instead of `risk`

```typescript
export const capabilityApprovalClasses = [
  "observe", "preview", "write", "destructive", "remote", "expensive",
] as const;

export const capabilityCheckpointPolicies = [
  "none", "before_preview", "before_write", "before_and_after",
] as const;
```

### `src/events/ledger.ts` — fully implemented, not a stub

```typescript
export const prismEventTypes = [
  /* ... */ "approval.requested", "approval.resolved", /* ... */
] as const;

export class InMemoryPrismEventLedger implements PrismEventLedger {
  append(input: PrismEventInput): PrismEvent { /* ... */ }
  list(options?: PrismEventListOptions): PrismEvent[] { /* ... */ }
  get(id: string): PrismEvent | undefined { /* ... */ }
  clear(): void { /* ... */ }
}
```

### What this confirms about scope

Both classes are genuinely in-memory (no SQLite backing, no cross-process sharing exists anywhere in Spectra yet — not even between the Workbench and its own daemon restarts). This means giving the cockpit's gateway process (`tools/ai-gateway.ts`) its own instances of `InMemoryApprovalQueue` and `InMemoryPrismEventLedger` is **exact parity** with how the Workbench does it today, not a downgrade. No new persistence work is in scope for this correction. If cross-process sharing becomes a real need later (cockpit and workbench seeing the same approval history), that's a separate, larger piece of work that doesn't exist as a pattern anywhere in the codebase yet and shouldn't be invented here.

---

## 2. What NOT to do (explicit guardrails for this slice)

- **Do not** register cockpit roles in `CapabilityRegistry`. It contains exactly one entry (`audio-processing`, `execute()` returns `{ success: false, error: 'Not implemented' }`). It is scaffold-only. Forcing cockpit roles into it would be premature complexity in the other direction — the same mistake, inverted.
- **Do not** merge the Cockpit and Workbench UIs, or redirect cockpit traffic through `/workbench`. Their separation is intentional and documented (`SPECTRA_WORKBENCH_SHELL.md` vs `PROJECT_COCKPIT.md`) — Workbench is the suite-wide AI-action review surface, Cockpit is local dev-process orchestration. Different jobs.
- **Do not** build a shared/persistent approval store. Nothing in Spectra has one yet. This fix should use the same in-memory pattern the Workbench already uses, not invent the next thing.
- **Do not** change the guided panel's one-click approve interaction. Dave currently clicks one button to approve and execute an action. That's the right amount of friction for a local dev tool he's running himself, and there's no reason to add a second confirmation step. The fix changes what happens *underneath* that click, not the click itself.

---

## 3. Mapping — `CockpitActionPacket` → `ApprovalRequestInput`

| Cockpit field (current, to retire) | Suite field (`ApprovalRequestInput`) | Notes |
|---|---|---|
| `workflow` | `metadata.workflow` (custom field on the resulting event, not a core field) | Suite schema has no `workflow` concept — carry it as ledger metadata instead |
| `role` | `relatedCapabilityId` left empty; carry as `metadata.cockpitRole` | Cockpit roles aren't capabilities (see §2) — don't force this mapping |
| `action` | `metadata.cockpitAction` | Preserve the original action kind for cockpit-side routing logic |
| `requiresApproval` | implicit — every `ApprovalRequestInput` IS a request; cockpit actions with `requiresApproval: false` simply don't call `requestApproval()` at all | No direct field needed |
| `risk: "none"\|"low"\|"medium"` | `approvalClass` (see §4 mapping table below) | Six-class taxonomy replaces the flat three-level one |
| `reason` | `summary` | Direct mapping |
| `commandPreview` | `cliEquivalent` | Direct mapping — this field already exists for exactly this purpose |
| `expectedOutcome` | `previewSummary` | Direct mapping |
| `failureRecovery` | `riskNotes: [failureRecovery]` | `riskNotes` is an array — append failure recovery text as one entry |
| `requiresTerminal` / `terminalHint` | `metadata.requiresTerminal`, `metadata.terminalHint` | No equivalent core field — these are cockpit-specific UX hints, correctly kept as metadata rather than expanding the suite schema |
| *(new)* `title` | derive from existing `actionTitle` logic already in the cockpit's `renderNextAction()` | No new logic needed — the cockpit already computes a human title for display |
| *(new)* `checkpointPolicy` | see §4 | New field cockpit must now set |
| *(new)* `localRemoteBoundary` | always `"local-only"` for cockpit actions | All cockpit actions are local process operations |
| *(new)* `requestedBy` | `"dave-cockpit"` (or read from the existing cockpit token/session if available) | Static value is fine for v1 |
| *(new)* `previewAvailable` | `true` when `commandPreview` is set, else `false` | Direct derivation |

---

## 4. Approval class + checkpoint policy mapping per cockpit action kind

| `CockpitActionKind` | `approvalClass` | `checkpointPolicy` | Reasoning |
|---|---|---|---|
| `start-role` | `write` | `before_write` | Spawns a new local process — a real side effect |
| `restart-owned-role` | `write` | `before_write` | Same — stops and respawns a process |
| `run-one-shot` | `write` | `before_write` | Executes shell commands (validation, git state checks) |
| `stop-owned-role` | `write` | `before_write` | Terminates a process the cockpit owns |
| `show-logs` | `observe` | `none` | Read-only — no approval flow needed at all; skip `requestApproval()` entirely |
| `open-linked-app` | `observe` | `none` | Opens a browser tab — no side effect; skip `requestApproval()` entirely |
| `acknowledge-external` | `observe` | `none` | Informational only; skip `requestApproval()` entirely |
| `refresh-status` | `observe` | `none` | Read-only poll; skip `requestApproval()` entirely |

No cockpit action currently needs `destructive`, `remote`, or `expensive`. The original audit's safety model already refuses kill actions against externally-owned processes server-side, and the cockpit has no `kill-external-port` action in its kind list — so `destructive` doesn't come up yet. If a future slice adds anything that kills a process the cockpit doesn't own, or executes a command outside the fixed preset list, that's the point to revisit this table, not before.

---

## 5. Implementation — files and exact changes

### File: `tools/ai-gateway.ts`

Add near the top, alongside existing imports:

```typescript
import { InMemoryApprovalQueue } from "../src/approvals/index.js";
import { InMemoryPrismEventLedger } from "../src/events/index.js";
```

Where the gateway currently constructs its options/state (near where `DB_PATH` and `MOCK_EXECUTORS` are set up), add:

```typescript
const eventLedger = new InMemoryPrismEventLedger();
const approvalQueue = new InMemoryApprovalQueue(eventLedger);
```

Pass both into `createProjectCockpitRouter(...)` alongside the existing options (`host`, `port`, `token`, `mockExecutors`, `dbPath`, `workDir`):

```typescript
const handleProjectCockpitRequest = createProjectCockpitRouter({
  // ...existing options unchanged...
  approvalQueue,
  eventLedger,
});
```

### File: `tools/cockpit/projectCockpit.ts`

**Add to `CockpitOptions`:**

```typescript
interface CockpitOptions {
  // ...existing fields unchanged...
  approvalQueue: ApprovalQueue;
  eventLedger: PrismEventLedger;
}
```

Add the import at the top:

```typescript
import type { ApprovalQueue, ApprovalRequestInput } from "../../src/approvals/index.js";
import type { PrismEventLedger } from "../../src/events/index.js";
```

**Retire `CockpitActionPacket` and `CockpitActionKind` as the wire format.** Keep `CockpitActionKind` as an internal-only type (it's still useful for the cockpit's own action-routing `switch`/`if` logic in `approveAction()`), but the object sent to and rendered by the browser should now be built directly as `ApprovalRequestInput` plus the cockpit-only metadata fields. Add a small mapping function near `deriveCockpitGuidance`:

```typescript
const APPROVAL_CLASS_BY_ACTION: Record<CockpitActionKind, CapabilityApprovalClass> = {
  "start-role": "write",
  "restart-owned-role": "write",
  "run-one-shot": "write",
  "stop-owned-role": "write",
  "show-logs": "observe",
  "open-linked-app": "observe",
  "acknowledge-external": "observe",
  "refresh-status": "observe",
};

const CHECKPOINT_POLICY_BY_ACTION: Record<CockpitActionKind, CapabilityCheckpointPolicy> = {
  "start-role": "before_write",
  "restart-owned-role": "before_write",
  "run-one-shot": "before_write",
  "stop-owned-role": "before_write",
  "show-logs": "none",
  "open-linked-app": "none",
  "acknowledge-external": "none",
  "refresh-status": "none",
};

function isApprovalRequired(action: CockpitActionKind): boolean {
  return APPROVAL_CLASS_BY_ACTION[action] === "write";
}
```

**Update `deriveCockpitGuidance()`** — every place it currently constructs a `CockpitActionPacket` object literal, build it with the additional fields needed for `ApprovalRequestInput` derivation. Concretely, each `nextAction` object gains a `title` (the cockpit already computes this in `renderNextAction()` client-side — move that derivation into `deriveCockpitGuidance()` server-side instead, since the approval request needs `title` before any HTML renders), and the existing `reason`/`commandPreview`/`expectedOutcome`/`failureRecovery` fields stay exactly as they are — they get mapped, not replaced.

**Add a new endpoint** to the cockpit's router (alongside the existing `/api/v1/cockpit/processes/{id}/{action}` routes):

```typescript
// POST /api/v1/cockpit/actions/approve
// body: { nextAction: <the action object from the current guidance payload> }
async function handleApproveGuidedAction(options: CockpitOptions, body: any) {
  const action = body.nextAction;
  const kind: CockpitActionKind = action.action;

  if (!isApprovalRequired(kind)) {
    // observe-class actions: no approval record needed, just execute/no-op
    return { ok: true, approvalSkipped: true };
  }

  const input: ApprovalRequestInput = {
    title: action.title ?? kind,
    summary: action.reason,
    approvalClass: APPROVAL_CLASS_BY_ACTION[kind],
    checkpointPolicy: CHECKPOINT_POLICY_BY_ACTION[kind],
    relatedArtifactIds: [],
    relatedFilePaths: [],
    previewAvailable: Boolean(action.commandPreview),
    previewSummary: action.expectedOutcome,
    cliEquivalent: action.commandPreview,
    riskNotes: action.failureRecovery ? [action.failureRecovery] : [],
    localRemoteBoundary: "local-only",
    requestedBy: "dave-cockpit",
  };

  const approval = options.approvalQueue.requestApproval(input);
  // Cockpit actions are single-click approve-and-execute by design (see §2 guardrails) —
  // resolve immediately rather than leaving it pending in a queue the user never reviews separately.
  options.approvalQueue.resolveApproval(approval.id, {
    status: "approved",
    decidedAt: new Date().toISOString(),
    decidedBy: "dave-cockpit",
  });

  return { ok: true, approvalId: approval.id };
}
```

Wire this into the router's request handling alongside the existing process-action routes. The cockpit's existing `approveAction()` client-side JS should call this new endpoint *before* calling the existing `/api/v1/cockpit/processes/{id}/{action}` endpoint that actually starts/stops the process — so the approval record exists before the side effect happens, matching `checkpointPolicy: before_write`.

### Client-side change (`renderProjectCockpitHtml()`, the `approveAction` function)

Minimal change — before the existing `api('/api/v1/cockpit/processes/...')` call, add one fetch to the new approve endpoint:

```javascript
async function approveAction(action) {
  try {
    if (action.action === 'show-logs' || action.action === 'open-linked-app' ||
        action.action === 'acknowledge-external' || action.action === 'refresh-status') {
      // observe-class — existing behavior unchanged, no approval record
      // ...existing show-logs / open-linked-app handling stays exactly as-is...
      return;
    }
    // write-class — record the approval first
    await api('/api/v1/cockpit/actions/approve', {
      method: 'POST',
      body: JSON.stringify({ nextAction: action }),
    });
    var apiAction = { 'start-role':'start', 'restart-owned-role':'restart', 'run-one-shot':'start' }[action.action];
    if (apiAction && action.role) {
      await api('/api/v1/cockpit/processes/' + encodeURIComponent(action.role) + '/' + apiAction, { method:'POST' });
      await loadProfile();
    }
  } catch (error) {
    alert(error.message || String(error));
  }
}
```

No visual change to the guided panel. The approve button still says exactly what it says now. The only difference is what happens server-side when it's clicked.

---

## 6. Tests to add

In `test/cockpit-html.test.ts` or a new `test/cockpit-approvals.test.ts`:

```typescript
import { InMemoryApprovalQueue } from "../src/approvals/index.js";
import { InMemoryPrismEventLedger } from "../src/events/index.js";

// Verify a write-class cockpit action creates a correctly-shaped approval request
const ledger = new InMemoryPrismEventLedger();
const queue = new InMemoryApprovalQueue(ledger);

const approval = queue.requestApproval({
  title: "Start Focus UI",
  summary: "Focus is not running. The bridge test requires the browser app on port 4173.",
  approvalClass: "write",
  checkpointPolicy: "before_write",
  relatedArtifactIds: [],
  relatedFilePaths: [],
  previewAvailable: true,
  previewSummary: "Focus UI is reachable at http://127.0.0.1:4173/ and cockpit-owned.",
  cliEquivalent: "python3 -m http.server 4173",
  riskNotes: ["Check that ~/Desktop/prism-focus exists and port 4173 is free."],
  localRemoteBoundary: "local-only",
  requestedBy: "dave-cockpit",
});

assert.equal(approval.status, "pending");
assert.equal(approval.approvalClass, "write");

queue.resolveApproval(approval.id, {
  status: "approved",
  decidedAt: new Date().toISOString(),
  decidedBy: "dave-cockpit",
});

const events = ledger.list({ type: ["approval.requested", "approval.resolved"] });
assert.equal(events.length, 2, "cockpit write-class actions must produce both a request and resolution ledger event");

// Verify observe-class actions never touch the queue
// (in the actual integration test: call handleApproveGuidedAction with a 'show-logs' action,
//  assert approvalSkipped === true and queue.listApprovals() length is unchanged)
```

---

## 7. What stays exactly as it is — do not touch

- The guided panel layout, mission statement, state summary, readiness checklist rendering
- The "What to do now" inline validation-failure card and "Run validation again" button
- `advancedOpen` / `openLogRoles` persistence across auto-refresh
- Copy buttons and text-window rendering
- All process-management server logic in `ProjectCockpit` (`start`, `stop`, `killPort`, `listeningPids`, `parsePidOutput`)
- The Workbench (`tools/daemon.ts`, `ui/workbench/index.html`, `src/workbench/dataSpine.ts`) — nothing in this slice touches it

This is a plumbing correction underneath an already-working UI, not a UX change.

---

## 8. Validation before considering this done

```bash
npm run typecheck
npm run test:cockpit
npm run test:ai-request
```

Manually: start the cockpit, click "Approve — Start Focus UI," confirm Focus actually starts (no behavior change from the user's point of view), then add a temporary log line or debugger to confirm `eventLedger.list()` now contains an `approval.requested` and `approval.resolved` pair for that click. Remove the temporary logging before committing.

---

## 9. Recommended follow-up (separate session, not part of this slice)

Once this lands, it becomes possible to show "recent cockpit actions" inside the guided panel by reading from `eventLedger.list({ source: "approval" })` directly — giving Dave a small "what did I just approve" history without building anything new, since the ledger is now the single source of truth for both Workbench and Cockpit approval activity. Worth a follow-up slice, not this one.
