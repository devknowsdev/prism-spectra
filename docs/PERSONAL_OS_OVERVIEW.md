# Personal Operating System — prism-spectra + prism-focus

Date: 2026-06-22

**Purpose**
- Provide a concise, actionable architecture and integration map that brings `prism-spectra` and `prism-focus` under a single local-first, privacy-preserving Personal Operating System (Personal OS). Focus: workflows optimized for ADHD and autism, and feature extensions for creators and musicians.

**Vision & Goals**
- Local-first AI orchestration: user intent → GraphBuilder → Router → ExecutionEngine → Executors, with safety and git-backed checkpoints.
- Low-friction UX for neurodivergent users: minimize choices, chunk work, surface single next actions, support audio/music workflows.
- Privacy-first: local-only model hosting where possible; explicit opt-in for cloud keys or installers.

**Core principles**
- Bind local services to `127.0.0.1` and protect with a startup-generated `x-local-token`.
- Sandbox all file-modifying runs to a per-project `workDir` and require explicit UI confirmation before applying patches or running terminal nodes.
- Use `CheckpointManager` for safe commits/rollbacks; show diffs before commit.
- Prefer progressive disclosure: surface simple suggestions first, advanced controls behind explicit expanded UI.

**Component map (who does what)**
- UI: [prism-focus/README.md](../../prism-focus/README.md) — widgets, Planner, Day Wizard, Focus Board, Music Tools. Hook points: Day Wizard, Planner, Task actions, Settings → AI.
- Adapter: a small local adapter in the dashboard (feature-detect `GET /api/v1/health`) that routes UI requests to the local orchestrator or to cloud fallbacks.
- Orchestrator: [prism-spectra/src/index.ts](../src/index.ts) — exports `GraphBuilder`, `Router`, `ExecutionEngine`. POC daemon at [prism-spectra/tools/daemon.ts](../tools/daemon.ts).
- Executors: local (`ollama`), remote (`gpt`/`claude`/`free_tier`) and side-effecting `terminal` executor. Pattern cache + ledger for budgeting and learning.

**Data flow (high level)**
ADHDashboard UI → AiAdapter (in-browser) → Local API (127.0.0.1 + token) or IPC (Electron) → AI‑Forge `GraphBuilder` → `Router` → `ExecutionEngine` → Executor → Patch/Result → `CheckpointManager` → UI results/preview.

**UX patterns: ADHD / Autism-friendly**
- Chunk tasks: present tasks as small, clearly-scoped steps with an obvious "next action".
- Rituals & scaffolding: Day Wizard with 3-5 guided prompts; tiny wins to reduce decision friction.
- Clear defaults & minimal prompts: limit branching choices; prefer a single recommended path with an "alternate" button.
- Explicit confirmations for file/terminal effects; preview diffs via `CheckpointManager.diff()` and require one-click approval.
- Low stimulation UI mode: reduce animations, limit auto-play audio, high-contrast and readable typography.
- Persistent, accessible aids: timers with audible and visual cues, adjustable tempo/metronome, and simple keyboard shortcuts.

**Creator & musician features**
- Integrate `Music Tools` (metronome, tuner, task music metadata) with focus sessions and practice logs.
- Audio-first input: voice notes → auto-transcribe → quick promote-to-task; retain audio blob in IndexedDB.
- Tempo-based workflows: tempo-linked timers, "practice session" presets (e.g., 25m/5m but tempo-aware), and automatic session tagging.
- AI-assisted composition: expose a capability in `prism-spectra` (e.g. `vibe-coding` / audio prompts) to generate small music/lyric suggestions and patches.
- Export hooks for DAW-friendly files (MIDI/text snippets, metadata bundles).

**Safety & security**
- Bind daemon to `127.0.0.1` only; require `x-local-token` header for all API calls.
- Require explicit UI confirmation before `terminal` or file-patch execution.
- Sandbox each project in a per-project `workDir` and require checkpoint preview before commit.
- Installer endpoints (`/api/v1/install-local`) must be gated: UI opt-in + daemon started with installer privilege OR Electron-run installer.

**Minimal local API (recommended)**
- `GET /api/v1/health` — `{ ok: true, available: true }`
- `POST /api/v1/build-graph` — `{ graphId, projectId, description, mode? }` → `{ graph, source, fallbackReason? }`
- `POST /api/v1/route` — `{ packet }` → `RouteDecision`
- `POST /api/v1/execute-graph` — body: `TaskGraph` → stream node progress and final results (mock first, SSE / WebSocket recommended)
- `POST /api/v1/install-local` — guarded installer (opt-in + privileged)

**POC status & entry points**
- See [README.md](../README.md) for core engine, demo and test runs.
- POC daemon: [tools/daemon.ts](../tools/daemon.ts) — mock executors for early testing.
- Dashboard AI integration: [prism-focus/src/ai.js](../../prism-focus/src/ai.js) and the app Settings → AI flow; feature-detect via `/api/v1/health`.

**Acceptance criteria (integration)**
- Dashboard can detect the local daemon and call `/api/v1/build-graph` and `/api/v1/route` returning valid responses.
- UI shows a Plan preview (graph node list) and allows manual ordering/acceptance before execute.
- Any node that writes files or runs shell commands requires explicit confirmation and shows a diff preview.
- Daemon bound to `127.0.0.1` with startup-generated `x-local-token`; `/install-local` is opt-in only.
- Core tests pass in mock mode; add integration tests for ledger/checkpoint/parallelism.

**Immediate next steps (prioritized)**
1. Dashboard feature-detection + Plan preview UI (short POC) — implement `AiAdapter` call in Planner/Day Wizard and show `build-graph` output as card list.
2. Add `/api/v1/execute-graph` (mock streaming) to the `prism-spectra` daemon (SSE first) so the UI can show live node progress.
3. Implement startup token generation + secure storage in daemon; update dashboard adapter to accept the token via Settings or secure prompt.
4. Add per-node diff preview using `CheckpointManager.diff(nodeId)` in the dashboard UI and require confirmation.
5. Add integration tests: GraphBuilder fallback, ledger rollovers, checkpoint rollback, parallel stress tests.

**Where to look in the code**
- prism-spectra core & modules: [README.md](../README.md) and [src/index.ts](../src/index.ts)
- POC daemon: [tools/daemon.ts](../tools/daemon.ts)
- Dashboard entry: [prism-focus/README.md](../../prism-focus/README.md) and `src/ai.js` for AI hooks.

**Next decision for you**
- I can implement the dashboard Plan preview now, or build the daemon `/api/v1/execute-graph` mock (streaming). Tell me which to do first and I will proceed.

---

*Generated and placed under `prism-spectra/docs/` as a single-source overview to guide integration and next work.*
