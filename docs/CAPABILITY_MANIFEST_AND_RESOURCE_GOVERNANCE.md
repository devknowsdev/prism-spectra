---
Last-Updated: 2026-06-24
Status: Implementation plan
---

# Capability Manifest and Resource Governance

## Purpose

This document turns the capability-palette harvest into an implementation plan for Prism Spectra.

The product rule is:

> Huge palette, tiny core.

Prism should be able to grow into a powerful local creative/development toolbox without loading every multimedia, multimodal, graph, model, or generative tool into the always-running core. Capabilities must be optional, manifest-governed, provenance-aware, resource-classified, and approval-gated.

## Core decision

Prism core owns:

- CLI and command mirror
- daemon/API
- event ledger
- approval queue
- checkpoint and rollback discipline
- attachment records and provenance
- capability registry
- resource/job governance
- local/remote boundary language
- settings and policy profiles

Capabilities provide optional skills such as:

- attachment ingest
- audio preview
- canvas notes
- project maps
- image processing
- video clipping
- transcription
- captioning/classification
- executable micro-recipes
- external sidecar integrations

The core must not become a multimedia monolith, universal node editor, or plugin bazaar.

## Load modes

```ts
export type LoadMode =
  | 'always'
  | 'lazy'
  | 'web_worker'
  | 'daemon_worker'
  | 'external_binary'
  | 'optional_sidecar'
  | 'reference_only'
  | 'avoid'
```

| Load mode | Meaning | Examples | Default policy |
|---|---|---|---|
| `always` | Required for Prism to function | ledger, registry, approvals, settings | Keep tiny |
| `lazy` | UI capability loaded only when opened | Excalidraw, React Flow, Uppy, wavesurfer.js | Safe for visual features |
| `web_worker` | Browser-side compute isolated from UI thread | small Transformers.js tasks, OCR experiments | One active by default |
| `daemon_worker` | Local daemon worker job | Sharp thumbnails, hashing, metadata enrichment | Queue and cancel |
| `external_binary` | System binary invoked by Prism | FFmpeg, whisper.cpp, ripgrep, git | Explicit job wrapper and provenance required |
| `optional_sidecar` | Whole external subsystem | llama.cpp server, ComfyUI, Node-RED-like runtimes | Disabled by default |
| `reference_only` | Study only | tldraw SDK, projectional editors, Open Canvas | No dependency |
| `avoid` | Do not integrate | unsafe/heavy/licence-hostile tools | Document reason |

## Resource profiles

```ts
export type CpuProfile = 'tiny' | 'small' | 'medium' | 'heavy' | 'extreme'
export type MemoryProfile = 'tiny' | 'small' | 'medium' | 'heavy' | 'extreme'
```

Recommended defaults for Apple Silicon M1 / 16GB RAM:

- Keep idle Prism core under roughly 1-1.5GB total app + daemon budget.
- Run only one heavy external job at a time by default.
- Require explicit confirmation before launching `heavy` or `extreme` jobs.
- Never auto-run transcription, video transcodes, local image generation, or large local model inference.
- Prefer preview-first, queue-first, and cancellation-capable jobs.
- Capture stdout/stderr/version/progress for every external binary job.

## User-facing resource modes

| Mode | Behaviour |
|---|---|
| Low-power mode | Disables automatic model features and limits workers to one small task |
| Preview-only mode | Blocks write/export actions while allowing previews and comparisons |
| Music-safe / performance-safe mode | Blocks transcription, embedding, media transcodes, and heavy model jobs during recording/performance contexts |
| Battery-safe mode | Forbids `heavy` and `extreme` jobs unless explicitly overridden |
| Expert mode | Allows denser controls, but still preserves approval gates and provenance |

## Capability manifest schema

```ts
export type PrismCapabilityManifest = {
  id: string
  title: string
  description: string

  category:
    | 'core'
    | 'cli'
    | 'visual'
    | 'canvas'
    | 'graph'
    | 'workflow'
    | 'code'
    | 'file'
    | 'attachment'
    | 'image'
    | 'audio'
    | 'video'
    | 'model'
    | 'search'
    | 'repair'
    | 'export'
    | 'plugin'
    | 'experimental'

  source: {
    repo?: string
    package?: string
    website?: string
    license: string
    licenseRisk: 'low' | 'medium' | 'high' | 'avoid'
    attributionRequired: boolean
  }

  runtime: {
    loadMode: LoadMode
    cpuProfile: CpuProfile
    memoryProfile: MemoryProfile
    supportsCancellation: boolean
    supportsProgress: boolean
    supportsPreview: boolean
    offlineCapable: boolean
    appleSiliconFriendly: boolean
  }

  boundaries: {
    localOnly: boolean
    remoteOptional: boolean
    remoteRequired: boolean
    sendsUserDataOffMachine: boolean
    modelDownloadRequired: boolean
  }

  safety: {
    approvalClass:
      | 'observe'
      | 'preview'
      | 'write'
      | 'destructive'
      | 'remote'
      | 'expensive'
    reversible: boolean
    checkpointPolicy:
      | 'none'
      | 'before_write'
      | 'before_and_after'
      | 'manual_only'
    riskNotes: string[]
  }

  io: {
    inputTypes: string[]
    outputTypes: string[]
    sideEffects: string[]
  }

  ui: {
    surfaces: Array<
      | 'cli'
      | 'command_palette'
      | 'resume'
      | 'approvals'
      | 'changes'
      | 'map'
      | 'canvas'
      | 'attachments'
      | 'conversation'
      | 'library'
      | 'settings'
    >
    density: 'calm' | 'standard' | 'expert'
  }

  provenance: {
    eventTypes: string[]
    storesArtifacts: boolean
    storesSettings: boolean
    storesModelInfo: boolean
  }

  commands: {
    cli: string[]
    api?: string[]
  }

  tests: {
    required: string[]
    fixtureTypes: string[]
  }
}
```

## Validation rules

A capability is invalid if any of these are true:

- `loadMode` is missing.
- `licenseRisk` is missing.
- `approvalClass` is missing.
- A capability with side effects declares `approvalClass: 'observe'`.
- A write/destructive/remote/expensive capability has no checkpoint policy or risk notes.
- A capability that sends user data off-machine does not declare `remoteRequired` or `remoteOptional`.
- A model capability with downloads does not set `modelDownloadRequired: true`.
- A heavy/extreme capability lacks cancellation or an explicit reason why cancellation is impossible.
- A capability registers UI surfaces but does not register matching CLI commands.

## Initial P0 capability candidates

| Capability | Candidate | Load mode | Implementation stance |
|---|---|---|---|
| Attachment ingest | Uppy | `lazy` | Direct dependency behind Prism wrapper |
| Audio preview | wavesurfer.js | `lazy` | Direct dependency |
| Image thumbnails / resize | Sharp | `daemon_worker` | Direct dependency in daemon worker |
| Video/audio jobs | native FFmpeg | `external_binary` | System binary wrapper |
| Local transcription | whisper.cpp | `external_binary` | External binary / optional sidecar |
| Calm canvas notes | Excalidraw | `lazy` | Thin wrapper |
| Focused project map | React Flow | `lazy` | Direct dependency |
| Small local caption/classify | Transformers.js | `web_worker` / `daemon_worker` | Small-model experiments only |

## Initial avoid/reference list

| Tool | Decision | Reason |
|---|---|---|
| tldraw SDK | Reference only | Production SDK licensing/key requirements make it poor as a default dependency |
| ComfyUI inside Prism process | Avoid direct integration | GPL coupling, graph-spaghetti risk, custom-node security concerns |
| AUTOMATIC1111 | Avoid | Security and runtime fragility concerns; poor fit for M1-first Prism core |
| Fooocus | Avoid as default | GPU-heavy assumptions and weaker fit for maintainable local palette |
| Essentia.js | Reference / sidecar only | AGPL risk and heavier analysis surface |
| Node-RED runtime | Reference / optional sidecar only | Too broad as an embedded runtime; useful for flow/parts-library ideas |
| Large sync frameworks | Not phase one | Prism is local-first first, not collaborative sync-first |

## Registry architecture

Suggested modules:

```text
src/capabilities/manifest.ts
src/capabilities/registry.ts
src/capabilities/validateManifest.ts
src/capabilities/resourcePolicy.ts
src/capabilities/jobQueue.ts
src/capabilities/provenanceEvents.ts
src/capabilities/binaryDiscovery.ts
src/capabilities/modelCache.ts
src/capabilities/NOTICE.md generator later
```

Responsibilities:

- Validate manifests before registration.
- Register CLI commands from manifests.
- Register UI surfaces only after validation.
- Deny unsafe commands by default.
- Route jobs to web worker, daemon worker, external binary, or sidecar.
- Emit provenance events for every job.
- Connect write/destructive/remote/expensive actions to approval cards.
- Track dependency/source attribution for NOTICE generation.

## First implementation sprint

Build the governance spine before integrating many real tools.

### Sprint goal

Create the capability manifest registry and prove that Prism can safely describe, validate, display, and govern optional capabilities.

### Scope

1. Add manifest types.
2. Add manifest validator.
3. Add resource policy classifier.
4. Add registry with in-memory registration.
5. Add placeholder manifests for:
   - Uppy attachment ingest
   - wavesurfer audio preview
   - Sharp thumbnail generation
6. Add provenance event stubs.
7. Add tests for valid and invalid manifests.
8. Add docs explaining how future capabilities plug in.

### Do not build yet

- Do not add ComfyUI, AUTOMATIC1111, Fooocus, or other full generative suites.
- Do not build a plugin marketplace.
- Do not auto-run model inference on attachments.
- Do not add a universal node editor.
- Do not add remote ingest by default.
- Do not bundle FFmpeg or whisper models before binary/model policy is settled.

## Codex-ready sprint prompt

```text
Implement the Prism Spectra capability manifest registry.

Goal:
Create the governance layer for optional Prism capabilities before adding heavy dependencies.

Files to inspect first:
- package.json
- tsconfig.json
- src/index.ts
- tools/daemon.ts
- existing docs around adapters, sidecars, checkpoints, and safety

Build:
1. Manifest types
   - Add TypeScript types for LoadMode, CpuProfile, MemoryProfile, and PrismCapabilityManifest.

2. Manifest validator
   - Validate required fields.
   - Reject missing load mode, licence risk, approval class, runtime profile, UI/CLI mismatches, and unsafe side effects.
   - Reject write/destructive/remote/expensive capabilities that do not declare checkpoint/risk policy.

3. Capability registry
   - Register valid manifests.
   - Expose list/get APIs internally.
   - Keep registration in memory for this sprint.
   - Do not load actual third-party libraries yet.

4. Resource policy
   - Classify capabilities by load mode and CPU/memory profile.
   - Provide a helper that says whether a capability can run under low-power, preview-only, battery-safe, and music-safe modes.

5. Provenance stubs
   - Define standard capability event names:
     capability.registered
     capability.rejected
     capability.job.scheduled
     capability.job.started
     capability.job.progress
     capability.job.preview_ready
     capability.job.completed
     capability.job.cancelled
     capability.job.failed

6. Placeholder manifests
   - Add examples for:
     - Uppy attachment ingest
     - wavesurfer.js audio preview
     - Sharp thumbnail generation
   - These should not import the real libraries yet.

7. Tests
   - Valid manifests register.
   - Invalid manifests are rejected with clear reasons.
   - Write-capable manifests require checkpoint policy.
   - Remote-capable manifests must declare boundary flags.
   - Heavy manifests are blocked in low-power mode.
   - Preview-only mode blocks write/destructive capabilities.

Constraints:
- Do not add heavy dependencies in this sprint.
- Do not implement UI integration yet.
- Do not add external binaries yet.
- Keep the core small and deterministic.
- Preserve local-first safety assumptions.

Expected output:
- Source code for manifest types, validation, registry, and resource policy.
- Placeholder manifests.
- Tests.
- Short docs note linking this work to the capability-palette harvest.

Commit message suggestion:
feat: add capability manifest registry scaffold
```
