# Personal AI Suite — Standing Project Brief

**Paste this whole file at the start of any new AI session (GPT, Claude, Cursor, anyone) before asking it to touch this repo.** It exists because this project is being built across many short-context sessions by different free-tier AIs, and the single biggest risk is not bad code — it's a new session inferring the wrong goal from whatever files happen to be in front of it. Read this before reading the code.

---

## 0. Latest Verified Repository Status (2026-06-19)

### Router Recovery

Verified recovery commit:

bdc34161715ede8add7caa7909493a6d4735ae66

Router recovery has been applied and validated.

Verified active router state:

- `export class Router`
- `route(packet: TaskPacket, exclude?: ExecutorName[])`

The legacy System B router entrypoint (`routeTask`) is no longer the active orchestration path.

### Stabilization Validation

Stabilization boundary commit:

cb04c68cf969c985e7cb281a0b71ee8431a6c3a6

Validation commands executed:

- `npm run typecheck`
- `npm test`

Results:

- Typecheck: PASS
- Tests: PASS
- 25 test(s) passed

Architecture classification:

ACTIVE
- Router
- ExecutionEngine
- TaskGraph
- Ledger
- LearningLoop

FUTURE-INTEGRATION
- taskClassifier
- modelRegistry
- localExecutor
- ollamaClient

EXPERIMENTAL
- runtime/*
- events/*
- executionCoordinator
- ledgerStore
- replay
- routing/types

Conclusion:

System A validates successfully after excluding identified FUTURE-INTEGRATION and EXPERIMENTAL subsystems from active typecheck coverage. No ACTIVE-path failures were detected.

---

## 1. The actual goal (the part that's easy to lose)

Build a **personal, mostly-local AI suite and coordinator** that:

- Runs a **team of small, specialized local AI models** (not one general model) — separate models for coding, reasoning, audio processing, planning/classification, etc. The point is to get free, high-grade capability by routing each task to the local model best suited for it, instead of paying for one big model to do everything badly.
- **Switches tasks between local and online options** as needed — falling back to free online accounts, then paid APIs (GPT, Claude), only when local specialists genuinely can't handle something. Cost-ascending, not cost-blind.
- **Integrates with existing tools** — Cursor, and presumably other coding/IDE tools, as additional executors the coordinator can dispatch to, not as separate disconnected workflows.
- Delivers three concrete user-facing capabilities: **vibe coding** (describe what you want, AI plans + writes + validates the code), **file management**, and **audio processing**.
- Has a **core coordinator** that manages all of the above: takes an intent, breaks it into tasks, routes each task to the right specialist (local or online), tracks cost/budget, remembers what worked, and keeps changes safe (nothing permanent until validated).

If a session is asked to build or fix something and it isn't obviously serving one of those things, stop and ask rather than building it.

---

## 2. What already exists — two codebases, not one

A previous round of work produced **two separate, non-integrating codebases** living in the same repo, because different sessions built different halves of the goal without realizing the other half already existed. Do not treat them as one architecture in transition.

(Original content retained below.)