---
Last-Updated: 2026-06-24
Status: Research baseline
---

# Prism Spectra Capability Palette Harvest

> Source note: this document records the capability-palette harvest direction for Prism Spectra. It is an implementation-oriented research baseline, not a legal opinion. Before adding any dependency, run a lockfile/SBOM and NOTICE audit against exact package versions.

## Executive findings

Prism Spectra should aim for a **small, calm, local-first core** plus a **manifest-governed capability palette**.

The goal is not to turn Prism into a universal multimedia suite, plugin bazaar, graph editor, or generative AI monolith. The goal is to let Prism grow into a local LEGO-like toolbox where capabilities can be loaded, inspected, approved, cancelled, and attributed without bloating the always-on core.

The strongest near-term harvest candidates are:

- **Excalidraw** for calm visual notes, recovery boards, and artifact sketches.
- **React Flow / xyflow** for focused project maps and lineage graphs.
- **Uppy** for local-first attachment ingest.
- **wavesurfer.js** for audio preview, regions, and transcript alignment surfaces.
- **Sharp** for image thumbnails, resizing, metadata, and export preparation.
- **Native FFmpeg** invoked as an external binary for video/audio clipping and contact sheets.
- **whisper.cpp** invoked as an external binary or optional sidecar for local transcription.
- **Transformers.js** for small local multimodal tasks such as captioning, classification, and embeddings.

The clearest traps are:

- **tldraw** as a direct production dependency, because the production SDK is not a straightforward permissive default.
- **ComfyUI** inside the trusted Prism process, because it is graph-spaghetti-prone, GPL-coupled, heavy, and exposed to custom-node supply-chain risks.
- **AUTOMATIC1111** as an integrated feature, because it is brittle, heavy, and has had serious security concerns.
- **Fooocus** as a default route, because it is GPU-oriented and not a clean fit for an M1/16GB local-first toolbox.
- **Essentia.js** as a direct core dependency, because of AGPL risk.
- **Node-RED** as an embedded runtime, because its flow runtime and plugin ecosystem are much larger than Prism's first capability layer needs.

## Product rule

> **Huge palette, tiny core.**

The core should stay boring and trustworthy. Optional power should live in governed capabilities.

## What belongs in Prism core

Prism core should own:

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
- provenance and attribution events

These are Prism identity features. They should not be outsourced to a third-party graph editor, agent runtime, or media suite.

## Capability classes

Capabilities should be grouped by how they affect user state and system resources.

| Class | Examples | Default stance |
|---|---|---|
| Visual shell | Excalidraw, React Flow, markdown/diff viewers | Lazy-load |
| Attachment ingest | Uppy, native file picker, metadata forms | Lazy-load, preview before import |
| Media preview | wavesurfer.js, browser-native image/video preview | Lazy-load |
| Image daemon job | Sharp thumbnailing/resizing/export | Daemon worker |
| Heavy media job | FFmpeg clip/transcode/contact sheet | External binary, queued |
| Local model job | whisper.cpp, Transformers.js, llama.cpp | Explicit, queued, never auto-run |
| Optional generative sidecar | ComfyUI, local image/video generation systems | Disabled by default, external boundary only |
| Reference/outlier | tldraw, Node-RED, MPS, Open Canvas, Spellburst | Study patterns, do not depend by default |

## Capability palette matrix

| Tool / repo | Category | License posture | Load mode | Prism use | Harvest mode | Risks | Priority |
|---|---|---|---|---|---|---|---|
| Excalidraw | Canvas | MIT | `lazy` | Calm visual notes, recovery boards, artifact sketches | Thin wrapper | large scene performance, assets/fonts | P0 |
| React Flow / xyflow | Graph UI | MIT | `lazy` | Focused project maps, lineage, small visual recipes | Direct dependency | graph sprawl if overused | P0 |
| Uppy | Attachment ingest | MIT | `lazy` | local-only file ingest, metadata review, thumbnails | Direct dependency | Companion/remote sources must be off by default | P0 |
| wavesurfer.js | Audio preview | BSD-3-Clause | `lazy` | waveform preview, regions, transcript alignment | Direct dependency | long-file memory and plugin scope | P0 |
| Sharp | Image processing | Apache-2.0 | `daemon_worker` | thumbnails, resize, image normalisation, exports | Direct dependency | native install/runtime considerations | P0 |
| Native FFmpeg | Media processing | LGPL/GPL depending build | `external_binary` | clipping, transcoding, contact sheets, audio extraction | External binary wrapper | build license and heavy CPU use | P0 |
| whisper.cpp | Speech-to-text | MIT | `external_binary` / `optional_sidecar` | local transcription, subtitles, voice notes | External binary wrapper | model downloads and thermal load | P0 |
| Transformers.js | Local multimodal inference | Apache-2.0 | `web_worker` / `daemon_worker` | captioning, classification, embeddings | Direct dependency for tiny models | model size, cache, backend differences | P1 |
| llama.cpp | Local LLM inference | MIT | `optional_sidecar` | local summarisation/chat/embeddings if Ollama is not enough | Optional sidecar/reference | model RAM, model licenses | P1 |
| Fabric.js | Canvas/layout | MIT | `lazy` | poster/social layout tooling | Prototype dependency | more editor complexity than Excalidraw | P1 |
| Rete.js | Executable workflow graph | MIT | `lazy` / `daemon_worker` | bounded executable recipes | Prototype dependency | plugin complexity and graph sprawl | P1 |
| LiteGraph.js | Lightweight graph engine | MIT | `lazy` / `daemon_worker` | tiny recipe engine / internal graph execution | Prototype dependency | dated UX, spaghetti risk | P1 |
| Node-RED | Flow runtime | Apache-2.0 | `reference_only` / `optional_sidecar` | study flow packaging/subflows and palette UX | Reference only | runtime/plugin sprawl | P2 |
| Tone.js | Music/creative audio | MIT | `lazy` | optional sequencer/instrument experiments | Prototype only | distractibility if core-visible | P2 |
| Meyda | Audio analysis | needs final audit | `web_worker` | lightweight audio features | Study/prototype | maintenance/license pass incomplete | P2 |
| Essentia.js | Music analysis | AGPL-3.0 | `reference_only` | study tempo/key/MIR ideas | Avoid direct dependency | AGPL and heavy/evolving APIs | P2 |
| Piper | TTS | older MIT archive / newer GPL successor | `optional_sidecar` | local read-aloud/accessibility | Sidecar only | project migration and license change | P2 |
| ffmpeg.wasm | Browser media jobs | MIT wrapper plus FFmpeg-derived core | `web_worker` | tiny browser-only transforms | Prototype only | slower than native, memory limits | P2 |
| tldraw | Infinite canvas | custom production SDK license | `reference_only` | study store/snapshot/runtime ideas | Conceptual reference | production license/key requirements | P2 |
| ComfyUI | Generative node graph | GPL-3.0 | `optional_sidecar` only | user-managed image/video generation | Optional sidecar/reference | GPL, heavy runtime, custom-node security, graph spaghetti | P2 |
| AUTOMATIC1111 | Stable Diffusion web UI | restrictive/risky posture for Prism | `avoid` | none beyond cautionary reference | Avoid | serious security and maintenance/runtime concerns | P3 |
| Fooocus | Simplified image generation UI | GPL-3.0 | `avoid` / user-managed sidecar | only as external app if user insists | Avoid for integration | GPU assumptions and stale release cadence | P3 |
| Open Canvas | Canvas/document agent UI | MIT but archived | `reference_only` | study artifact-centric writing flow | Conceptual reference | archived | P2 |
| OpenHands Agent Canvas | Agent workspace | MIT parts, heavy product | `reference_only` | study multi-panel agent workflow | Conceptual reference | filesystem privilege and runtime weight | P2 |
| JetBrains MPS / JetPad | Projectional editor | Apache-2.0 | `reference_only` | study structured/projectional editing | Conceptual reference | far too heavy | P2 |
| Spellburst | Research interface | paper/demo | `reference_only` | branching prompt/code exploration | Conceptual reference | no production harvest target | P2 |

## Standard toolkit recommendation

| Need | Recommended candidate | Fallback | First Prism integration point |
|---|---|---|---|
| File ingest | Uppy core + Dashboard/headless | native file picker + custom dropzone | Attachments panel |
| Metadata | Sharp metadata + FFmpeg/ffprobe + file stats | later ExifTool audit | attachment enrich job |
| Audio preview | wavesurfer.js | native audio element | attachment preview |
| Image preview/thumbnail | browser-native preview + Sharp canonical thumbnails | Uppy thumbnails for ingest preview | attachment ingest |
| Video preview/thumbnail | native video + FFmpeg contact sheet/frame grab | browser poster frame | attachment preview |
| Diffing | git diff + lightweight HTML renderer | raw unified diff | Changes/Approvals |
| Local search | ripgrep external binary | in-process search for small projects | CLI/search panel |
| Graph/map | React Flow | Excalidraw for non-executable sketches | Map surface |
| Markdown/docs | react-markdown or lower-level micromark | plain text renderer | conversation/docs surface |
| Canvas/whiteboard | Excalidraw | Fabric.js for layout-specific tools | Canvas notes |
| Transcription | whisper.cpp | tiny Transformers.js ASR only for short clips | Transcribe action |
| Image processing | Sharp | ImageMagick as external fallback | thumbnail/export/repair |
| Video clipping | native FFmpeg | ffmpeg.wasm for tiny browser-only jobs | media job queue |
| Local caption/classify | Transformers.js with small vetted models | optional sidecar model service | attachment classify/caption action |
| OCR | Tesseract.js or external Tesseract later | manual extraction | attachment extract-text action |
| Repair/normalisation | Sharp + FFmpeg + small Prism fixers | ImageMagick for edge formats | repair preview |

## Visual modes

Prism should have three distinct visual modes:

1. **Calm canvas**
   - Excalidraw-style visual notes.
   - Used for recovery, sketches, planning, and artifact boards.
   - Not the authoritative execution layer.

2. **Focused map**
   - React Flow-style node/edge view.
   - Used for current task, artifact lineage, checkpoint path, changed files, and parts reuse.
   - Scoped by default; not a full-project hairball.

3. **Small executable recipes**
   - Rete.js/LiteGraph-style prototypes only.
   - Used for bounded workflows such as ingest → transform → export.
   - CLI remains authoritative.

## Outlier ideas worth studying

| Idea | Source family | Prism translation | Risk |
|---|---|---|---|
| Branching creative exploration | Spellburst-like systems | branch prompts/code/artifacts into variants | can become chaotic |
| Multimodal artifact nodes | Story/media node research | represent code, image, audio, video, chat outputs as typed nodes | graph overload |
| Artifact-first writing canvas | Open Canvas-style tools | work on document/artifact, not chat transcript | agent memory complexity |
| Agent canvas multi-panel workbench | OpenHands Agent Canvas | study panel composition and resumability | privilege and runtime weight |
| Projectional editing | MPS/JetPad | structured manifest/recipe editor | too heavy if generalized |
| Text-to-graph bridge | Rete Studio-like ideas | visualise small CLI recipes while retaining textual source | graph ideology |
| Subflow packaging | Node-RED | Prism reusable parts/recipes | plugin sprawl |
| Canvas store snapshots | tldraw ideas | migrate/version Prism canvas scenes | license constraints |
| Object graph workspace | Anytype-like ideas | typed local artifact relations | knowledge-OS sprawl |
| Notebook/artifact cards | Jupyter-like workflows | experiment cards with inputs, outputs, rerun | kernel-heavy UX if copied |

## Resource governance model

Prism should classify every capability before it can run.

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

export type CpuProfile = 'tiny' | 'small' | 'medium' | 'heavy' | 'extreme'
export type MemoryProfile = 'tiny' | 'small' | 'medium' | 'heavy' | 'extreme'
```

Recommended defaults for Apple Silicon M1 / 16GB RAM:

- Keep idle core lean.
- Allow one medium daemon job or one heavy external job at a time by default.
- Require explicit confirmation before launching `heavy` or `extreme` capabilities.
- Never auto-run transcription, video transcodes, local generation, or large model inference on file import.
- Prefer queue/cancel/progress/provenance for every media/model job.
- Use low-power, battery-safe, preview-only, and music-safe modes.

## Capability manifest requirement

Every capability must declare:

- id, title, description
- category
- source repo/package/license
- license risk and attribution needs
- load mode
- CPU/memory profile
- cancellation/progress/preview support
- local/remote boundary
- model download requirements
- approval class
- reversible/irreversible status
- checkpoint policy
- input/output types
- side effects
- UI surfaces
- CLI/API commands
- provenance event types
- tests and fixtures

This prevents a capability from becoming active merely because it is installed.

## First prototype sprint

The first sprint should prove the governance layer and only a few safe capabilities.

### Sprint target

Build the capability manifest registry and wire three placeholder capabilities through validation and resource policy.

### Include

- manifest types
- manifest validator
- registry
- resource policy classifier
- provenance event names
- placeholder manifests for:
  - Uppy attachment ingest
  - wavesurfer.js audio preview
  - Sharp thumbnail generation
- tests for valid/invalid manifests
- tests for low-power, preview-only, battery-safe, and music-safe modes

### Do not include yet

- ComfyUI/AUTOMATIC1111/Fooocus integration
- external FFmpeg bundling
- whisper model downloads
- full project graph editor
- plugin marketplace
- automatic model inference on attachments
- remote ingest by default

## Immediate capability harvest targets

P0:

- Uppy attachment ingest
- wavesurfer.js preview
- Sharp image pipeline
- React Flow project map
- Excalidraw canvas notes
- FFmpeg external binary wrapper
- whisper.cpp external binary wrapper
- capability manifest registry

P1:

- Transformers.js small local tasks
- Rete.js or LiteGraph.js executable micro-recipe prototype
- Fabric.js layout/poster prototype
- llama.cpp optional sidecar review

## Do-not-harvest list

- Do not embed ComfyUI in the trusted Prism process.
- Do not integrate AUTOMATIC1111.
- Do not make Fooocus a default capability.
- Do not use tldraw as a default dependency without a license decision.
- Do not add Node-RED as the Prism runtime.
- Do not add Essentia.js directly to core.
- Do not add any heavy model job that runs automatically on file import.

## Final recommendation

Prism should become powerful by **governing capabilities**, not by absorbing large products.

The app should feel small at rest, clear under pressure, and expandable only when the user explicitly asks for a capability.