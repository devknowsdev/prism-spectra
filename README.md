---
Last-Updated: 2026-06-24

# prism-spectra

Local-first AI orchestration and execution engine for the Prism workspace.
It provides the routing, memory, checkpointing, and capability surfaces that
support the dashboard and workspace coordination docs.

## Ecosystem Role

This repository is responsible for Prism Core orchestration, capability
routing, adapters, memory, safety, and execution provenance.
It is not responsible for ADHDashboard state or public music publication.
For ecosystem-wide architecture, see [prism-beam/docs/ECOSYSTEM_OVERVIEW.md](https://github.com/devknowsdev/prism-beam/blob/main/docs/ECOSYSTEM_OVERVIEW.md)
and [prism-beam/docs/REPO_BOUNDARIES.md](https://github.com/devknowsdev/prism-beam/blob/main/docs/REPO_BOUNDARIES.md).

For adapter contract details and the local mock scaffold, see
[docs/ADAPTER_CONTRACTS.md](docs/ADAPTER_CONTRACTS.md).

For the local `.prism.json` sidecar convention and the planning-only ingest
helpers, see [docs/LOCAL_FILE_SIDECAR_CONVENTION.md](docs/LOCAL_FILE_SIDECAR_CONVENTION.md)
and [docs/LOCAL_FILE_INGEST_PLANNING.md](docs/LOCAL_FILE_INGEST_PLANNING.md).

For the explicit-file sidecar command contract, see
[docs/LOCAL_FILE_SIDECAR_COMMAND_CONTRACT.md](docs/LOCAL_FILE_SIDECAR_COMMAND_CONTRACT.md).

For copy-paste integration examples, see
[docs/LOCAL_FILE_SIDECAR_COMMAND_EXAMPLES.md](docs/LOCAL_FILE_SIDECAR_COMMAND_EXAMPLES.md).

For the implementation handover packet, see
[docs/LOCAL_FILE_SIDECAR_HANDOVER.md](docs/LOCAL_FILE_SIDECAR_HANDOVER.md).

For the current build boundary and stabilization rationale, see
[docs/BUILD_STABILIZATION_NOTES.md](docs/BUILD_STABILIZATION_NOTES.md).

For the open-source harvest baseline and implementation plan, see
[docs/OPEN_SOURCE_HARVEST_AUDIT.md](docs/OPEN_SOURCE_HARVEST_AUDIT.md)
and [docs/HARVEST_IMPLEMENTATION_PLAN.md](docs/HARVEST_IMPLEMENTATION_PLAN.md).

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
