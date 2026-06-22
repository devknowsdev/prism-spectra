---
Last-Updated: 2026-06-22

# prism-spectra — Project Portal

Concise orientation and navigation for contributors working on the local AI orchestrator.

Overview
- Local-first Node TypeScript orchestrator and POC daemon (`tools/daemon.ts`) providing graph build, routing and execution with git-backed checkpoints.

Quick start
- Read: [PROJECT_BRIEF.md](../PROJECT_BRIEF.md) and [README.md](../README.md)
- Run tests: `npm test` (project uses `tsx`/Node tooling)

Key orientation docs
- [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)
- [SYSTEM_PRINCIPLES.md](../SYSTEM_PRINCIPLES.md)
- [REFERENCE_ARCHITECTURE_LOCAL_AI.md](../REFERENCE_ARCHITECTURE_LOCAL_AI.md)
- [docs/PERSONAL_OS_OVERVIEW.md](../docs/PERSONAL_OS_OVERVIEW.md)
- [docs/REPO_AUDIT.md](../docs/REPO_AUDIT.md)
- POC daemon: [tools/daemon.ts](../tools/daemon.ts)
- Checkpoints: [src/safety/checkpoint.ts](../src/safety/checkpoint.ts)

Workspace-level portal (canonical)
- This file is the canonical workspace-level portal. `prism-focus` links to this portal from [docs/PROJECT_PORTAL.md](../../prism-focus/docs/PROJECT_PORTAL.md).

Where to look for common changes (recipes)
- **Add/modify executor / patch application**: `src/engine/*`, `src/safety/checkpoint.ts`, `tools/daemon.ts` (preview/execute endpoints).
- **Add new capability or router rule**: `src/routing/*`, `src/engine/*`, and update `docs/ROADMAP_v1.md` and `docs/BUILD_SPEC_v1.md` if needed.
- **Undo / checkpoint flow**: `src/safety/checkpoint.ts` + DB `checkpoints` table; validate with `test/run.ts` e2e harness in `test/`.

Developer tools & tests
- Unit & integration: `npm test` (see `test/` harness)
- Audit & build spec: `docs/REPO_AUDIT.md`, `docs/BUILD_SPEC_v1.md`

Recommendations
- Create `docs/CHANGE_GUIDE.md` mapping common change types to exact files + tests to run.
- Add CI check that regenerates any `generated/` artifacts and updates `docs/PROJECT_PORTAL.md` if stale.
