---
Last-Updated: 2026-06-25

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

For first-run setup, doctor checks, provider status, and workbench launch guidance,
see [docs/SPECTRA_SETUP.md](docs/SPECTRA_SETUP.md).

For the current test-surface split and daemon e2e stabilization notes, see
[docs/TEST_STABILIZATION.md](docs/TEST_STABILIZATION.md).

For the read-only suite AI request gateway, see
[docs/AI_REQUEST_GATEWAY.md](docs/AI_REQUEST_GATEWAY.md).

## What this repo is for

- Deterministic graph building and routing
- Local execution with checkpointed safety trails
- Capability composition for file, audio, and coding workflows
- Reference architecture for the workspace's AI layer

## Start here

- Read [docs/PROJECT_PORTAL.md](docs/PROJECT_PORTAL.md)
- Read [PROJECT_BRIEF.md](PROJECT_BRIEF.md)
- Run `npm install`
- Run `npm run doctor`
- Run `npm run setup` for the read-only first-run checklist
- Inspect [src/index.ts](src/index.ts)
- Inspect [tools/daemon.ts](tools/daemon.ts)

## First-run setup

Run the read-only doctor from the repo root:

```bash
npm install
npm run doctor
```

Then validate the setup/build path:

```bash
npm run test:setup
```

Provider status, without executing a workflow:

```bash
npm run forge -- --status
```

Workbench launch, only when ready for a long-running local daemon:

```bash
npm run workbench
```

Read-only AI gateway launch, only when intentionally testing suite AI request routing:

```bash
npm run ai:gateway
```

## Tests

Run CI-safe setup validation with:

```bash
npm run test:setup
```

Run the AI request contract test with:

```bash
npm run test:ai-request
```

Run the existing full harness deliberately when working on daemon, workbench,
checkpoint, execute-graph, rollback, preview, attachment, or event-ledger behavior:

```bash
npm test
# or
npm run test:full
```

For current test-surface notes, see [docs/TEST_STABILIZATION.md](docs/TEST_STABILIZATION.md).

If you are working on orchestrator behavior, also run:

```bash
npm run demo
```

For a disposable local fixture harness, see
[docs/LOCAL_SANDBOX_HARNESS.md](docs/LOCAL_SANDBOX_HARNESS.md).
