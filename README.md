---
Last-Updated: 2026-06-22

# prism-spectra

Local-first AI orchestration and execution engine for the Prism workspace.
It provides the routing, memory, checkpointing, and capability surfaces that
support the dashboard and workspace coordination docs.

## What this repo is for

- Deterministic graph building and routing
- Local execution with checkpointed safety trails
- Capability composition for file, audio, and coding workflows
- Reference architecture for the workspace's AI layer

## Start here

- Read [docs/PROJECT_PORTAL.md](docs/PROJECT_PORTAL.md)
- Read [PROJECT_BRIEF.md](PROJECT_BRIEF.md)
- Inspect [src/index.ts](src/index.ts)
- Inspect [tools/daemon.ts](tools/daemon.ts)

## Tests

Run the repo test suite with:

```bash
npm test
```

If you are working on orchestrator behavior, also run:

```bash
npm run demo
```
