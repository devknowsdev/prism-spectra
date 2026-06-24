# Spectra Workbench Data Spine

This document records the read-only data spine that powers the first Spectra Workbench shell.

- The workbench reads daemon-derived summaries for resume, approvals, changes, and capability metadata.
- It now also reads the in-memory event ledger and approval queue contracts introduced in Sprint 025.
- No heavy capabilities are integrated here.
- No write routes are added by this scaffold.
- No execution path is exposed through the workbench data routes.
- The explicit-file sidecar subsystem remains closed and unchanged.
- Empty approval and change states are intentional when the daemon has no corresponding records.
- Future approval cards, provenance timelines, and status summaries should continue to read these manifest and daemon summaries instead of inventing new state.

The current read-only routes are:

- `GET /api/v1/events`
- `GET /api/v1/approvals`
- `GET /api/v1/workbench/resume`
- `GET /api/v1/workbench/approvals`
- `GET /api/v1/workbench/changes`
- `GET /api/v1/capabilities/manifests`

Future UI layers can use these payloads to generate safe next actions, approval cards, timeline entries, and manifest-filtered capability views without changing the sidecar boundary.
