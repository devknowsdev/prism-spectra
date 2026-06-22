# Workspace Navigation & Maintenance Guide

Last updated: 2026-06-22

Purpose
- A single, compact navigation and operational reference that lets a low-capacity LLM (Claude/free instance) or a human quickly orient across the two repositories in this workspace (`prism-focus` and `prism-spectra`), make small, safe edits, and propose surgical changes without scanning the entire codebase and wasting tokens.

Usage rules for an LLM operator
- Only open files from the `fileIndex` below. Do not attempt bulk reads of the repo.
- Limit raw file content included in prompts to ~1200 tokens per file. Prefer targeted sections (functions, top 200 lines, specific export) instead of whole files.
- For any proposed change, produce a unified, minimal patch in the repository `apply_patch` format (V4A diff) with no more than one logical change per patch.
- All patches that modify code or run commands must be accompanied by a short test plan and the exact smoke test command (see `Quick checks` below). Do not run patches without human confirmation.
- When summarizing or extracting information, return structured JSON with keys: `file`, `summary`, `linesOfInterest` (line ranges), `confidence` (low/med/high).

High-level workspace map

 - prism-focus (vanilla JS app, no build step)
  - Main entry: prism-focus/index.html
  - Boot: prism-focus/src/init.js
  - Key runtime files: prism-focus/src/state.js, prism-focus/src/storage.js, prism-focus/src/render.js
  - AI & commands: prism-focus/src/ai.js, prism-focus/docs/AI_API.md
  - Tests: prism-focus/src/test_workflows.js (node harness)
  - Generated: prism-focus/generated/AI_CONTEXT.md, prism-focus/generated/PROJECT_INDEX.md

- AI-Forge (TypeScript orchestrator/engine)
  - Public surface: AI-Forge/src/index.ts
  - POC daemon: AI-Forge/tools/daemon.ts
  - Config & bootstrap: AI-Forge/README.md, AI-Forge/PROJECT_BRIEF.md, AI-Forge/docs/PROJECT_PORTAL.md
  - Scripts: run with `npm run demo` or `npm test` (requires Node >=22 per package.json)

Duplicate / overlapping docs (candidates for dedupe or canonicalization)
- `PERSONAL_SYSTEMS_CONSTITUTION.md` — exists in both roots; recommendation: keep canonical copy in `AI-Forge/` (global OS brief) and convert `ADHDashboard` copy to a lightweight pointer that links to the canonical file.
- `PROJECT_PORTAL.md` — intentionally per-repo; keep both but mark `AI-Forge/docs/PROJECT_PORTAL.md` as the workspace-level portal and add a cross-link in `ADHDashboard-git/docs/PROJECT_PORTAL.md`.
- `README.md` — keep per-repo.
- `HANDOVER` / `HANDOFF` files — keep as scoped handoff docs; consider consolidating repeated procedural items into `AI-Forge/docs/SESSION_HANDOVER_TEMPLATE.md` and link per-project.
- `PROJECT_INDEX.md` vs `generated/PROJECT_INDEX.md` (ADHDashboard): `generated/PROJECT_INDEX.md` is auto-generated; keep it but avoid manual edits. If `PROJECT_INDEX.md` (top-level) is duplicate, either remove or keep as human-facing summary and mark as canonical.

Quick checks / smoke commands
- ADHDashboard (from project root):
```bash
node src/test_workflows.js
python3 -m http.server 8080   # serve for manual UI checks
```
- AI-Forge:
```bash
cd "AI-Forge"
npm test
npm run demo
```

Surgical edit recipe (recommended, minimal risk)
1) Pick a target file from `fileIndex` below. Reply with `open: <path>` to request the file contents.
2) Ask the LLM to produce a minimal change and show a V4A apply_patch diff (include 3 lines of context by default). Example patch header must use absolute workspace paths.
3) Human reviews patch; if accepted, apply using the `apply_patch` tool or `git apply` locally. Run the test commands above.
4) If tests fail, revert and iterate; attach a short failure diagnostic to the patch for follow-up.

Guidelines to limit token usage
- Do not concatenate many files into a single prompt. Operate file-by-file using the index.
- Use the JSON `fileIndex` to choose the next file to open. When possible, ask for a targeted excerpt (function or class) rather than the whole file.
- Prefer structured outputs (JSON) from the model to reduce token noise.

FileIndex (compact, parse-first for an LLM)
{
  "prism-focus": [
    {"path":"prism-focus/README.md","desc":"Project overview + quickstart"},
    {"path":"prism-focus/docs/ORIENTATION.md","desc":"Developer map and load order"},
    {"path":"prism-focus/docs/AI_API.md","desc":"AI call envelope and allowed commands"},
    {"path":"prism-focus/generated/AI_CONTEXT.md","desc":"Generated AI context map"},
    {"path":"prism-focus/src/state.js","desc":"Global mutable state (migration in progress)"},
    {"path":"prism-focus/src/storage.js","desc":"localStorage persistence"},
    {"path":"prism-focus/src/render.js","desc":"Main render orchestrator"},
    {"path":"prism-focus/src/init.js","desc":"Boot/migration/startup"},
    {"path":"prism-focus/src/test_workflows.js","desc":"Node test harness (331 tests expected)"}
  ],
  "prism-spectra": [
    {"path":"prism-spectra/README.md","desc":"Engine overview & demo instructions"},
    {"path":"prism-spectra/PROJECT_BRIEF.md","desc":"Standing project brief — paste into new sessions"},
    {"path":"prism-spectra/REFERENCE_ARCHITECTURE_LOCAL_AI.md","desc":"Local AI orchestration architecture"},
    {"path":"prism-spectra/src/index.ts","desc":"Public exports: GraphBuilder, Router, ExecutionEngine"},
    {"path":"prism-spectra/tools/daemon.ts","desc":"POC daemon to mock executors / API"},
    {"path":"prism-spectra/docs/PROJECT_PORTAL.md","desc":"Repo-level portal and checklist"},
    {"path":"prism-spectra/docs/REPO_AUDIT.md","desc":"Audit notes and keep/refactor/remove guidance"}
  ]
}

Maintenance recommendations (non-destructive)
- Add `Last-Updated: YYYY-MM-DD` frontmatter to top-level docs (`README.md`, `PROJECT_PORTAL.md`, `PROJECT_BRIEF.md`, `ORIENTATION.md`) to aid LLM session freshness checks.
- Tag auto-generated files (`generated/*`) with a clear header: "AUTO-GENERATED — DO NOT EDIT" and link to generator.
- Do not delete files automatically. Propose an archival step: move duplicates into `docs/archived/` with a short rationale and cross-link to canonical doc.
- Archived files: `ADHDashboard-git/docs/archived/` contains archived handoff docs and the original `PERSONAL_SYSTEMS_CONSTITUTION.md`.

Next actions I can take now
- Create a canonical workspace navigation file (this file) — done.
- Produce a `docs/archival-proposal.md` listing exact candidate files to archive (I can prepare it if you want).
- Run the smoke checks for both projects and report results.

If you'd like me to proceed: tell me whether to (A) prepare the archival proposal, (B) run smoke tests now, or (C) start implementing one small canonicalization (e.g., move `PERSONAL_SYSTEMS_CONSTITUTION.md` to `AI-Forge` and replace the other with a pointer).
