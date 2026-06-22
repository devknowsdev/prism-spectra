# Change Guide — Mapping changes to files and tests

Last-Updated: 2026-06-22

Purpose: quick mapping for common change types so an engineer or LLM can make small, safe edits and run the right smoke checks.

ADHDashboard (UI + state)
- UI changes (visual/layout): edit `src/render_*.js` and accompanying `src/actions_*.js` if behavior changes. Smoke test: `node src/test_workflows.js`.
- State or persistence: edit `src/state.js`, `src/state/*` (migration), and `src/storage.js`. Smoke test: `node src/test_workflows.js`.
- Add widget: follow `src/WIDGET_GUIDE.md`, register in `src/widget_registry.js`, include script tag in `index.html`. Smoke test: `node src/test_workflows.js` and manual UI check via `python3 -m http.server 8080`.
- AI integration: `src/ai.js`, `src/ai_exec.js`, `docs/AI_API.md`. Smoke test: `node src/test_workflows.js`.

AI-Forge (engine)
- Executors / daemon: `src/executors/*`, `tools/daemon.ts`. Smoke test: `npm test` (run from `AI-Forge`).
- GraphBuilder / Router / ExecutionEngine: `src/intelligence/*`, `src/routing/*`, `src/engine/*`. Smoke test: `npm test` and `npm run demo` for end-to-end verification.
- Safety & checkpoints: `src/safety/checkpoint.ts` and `test/` e2e harness. Smoke test: `npm test` (see `test/run.ts`).

General rules
- Always produce a single V4A apply_patch diff per change and include a short test plan.
- Prefer small changes: one logical change per patch. Avoid broad refactors without prior discussion.
- When editing code that affects runtime, run the relevant smoke test(s) listed above and attach results to the patch.
