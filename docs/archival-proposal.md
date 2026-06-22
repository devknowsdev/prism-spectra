# Archival Proposal — Candidate files for non-destructive archive

Last-Updated: 2026-06-22

Purpose
- List exact files that are redundant, duplicated, or low-value, and propose moving them to `docs/archived/` with a short rationale. This is non-destructive: files remain in the repo under `docs/archived/` and cross-links point to the canonical copy.

Candidates

1) `ADHDashboard-git/PERSONAL_SYSTEMS_CONSTITUTION.md`
  - Rationale: duplicate of `AI-Forge/PERSONAL_SYSTEMS_CONSTITUTION.md`. Already archived in `ADHDashboard-git/docs/archived/PERSONAL_SYSTEMS_CONSTITUTION.md`.

2) Any `HANDOFF` / `HANDOVER` documents that are session-scoped and duplicated across repos:
  - `ADHDashboard-git/src/HANDOFF_ai.md`
  - `ADHDashboard-git/src/HANDOFF_day_wizard.md`
  - `AI-Forge/HANDOVER.md` (if overlapping content)
  - Rationale: keep per-repo handoffs but move older session handover notes to `docs/archived/` once integrated into `AI-Forge/docs/SESSION_HANDOVER_TEMPLATE.md`.

3) Generated artifacts that are safe to keep but should be clearly marked:
  - `ADHDashboard-git/generated/*` — ensure `AUTO-GENERATED` header present (done for `AI_CONTEXT.md` and `PROJECT_INDEX.md`).

Procedure
- For each candidate:
  1. Move the file to `docs/archived/<original-path-with-dates>/` (preserve filename).
  2. Create a small pointer at the original path referencing the canonical file in `AI-Forge` if appropriate, or the archived copy.
  3. Update `WORKSPACE_NAVIGATION.md` to list archived files as `archived` with short rationale.

If you approve, I will execute the archival moves now for the listed candidates and update the navigation file accordingly. 
