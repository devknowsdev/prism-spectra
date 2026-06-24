# Attachment Preview Foundation

Sprint 030 adds a conservative preview contract for local attachments and a UI preview slot in the Spectra Workbench.

## Scope

- The preview model is metadata-driven.
- No preview libraries were added.
- No thumbnailing, OCR, AI analysis, EXIF parsing, or media inspection was added.
- No arbitrary local file serving was added.
- No sidecar behavior changed.
- No approval execution changed.

## Preview Contract

Each attachment projection now carries preview metadata with fields like:

- `preview.kind`
- `preview.status`
- `preview.label`
- `preview.reason?`
- `preview.safeToRenderInline`
- `preview.requiresExternalTool`
- `preview.requiresUserAction`
- `preview.capabilityId?`
- `preview.riskNotes`
- `preview.source`

Supported preview kinds are conservative:

- `none`
- `image`
- `text`
- `audio`
- `video`
- `pdf`
- `binary`
- `unknown`

The classifier only uses existing attachment metadata:

- MIME type
- display/original name extension
- size when available
- local source path presence

## Classification Rules

- `image/*` attachments can preview inline through a safe local preview route.
- `audio/*` attachments can preview inline through a safe local preview route, with waveform UI loaded lazily after explicit user action.
- `video/*` attachments can preview inline with browser-native video controls.
- `application/pdf` attachments can preview inline with browser-native PDF embedding when the browser supports it.
- `text/*` attachments stay conservative and point to a future safe text preview route.
- Unknown or binary attachments remain unsupported.
- Large attachments get a risk note so the UI can warn before rendering.

## Safe Route Policy

The optional preview route is:

- `GET /api/v1/workbench/attachments/:id/preview`

That route must stay:

- read-only
- attachment-id based
- path-safe
- bounded to the local upload area
- unable to serve arbitrary user-supplied file paths
- unable to transform media

If the attachment storage cannot serve bytes safely, the route should remain unavailable and the UI should fall back to metadata only.

## Browser-Native Preview Rules

- Use native HTML only for the baseline preview kinds.
- Keep specialized waveform, thumbnail, and transcoding libraries manifest-gated and lazy-loaded.
- Do not autoplay media.
- Do not fetch remote preview URLs.
- Do not expose local file paths as direct links.

## Future Preview Path

This sprint is only the foundation for later preview work such as:

- text preview rendering
- image thumbnails
- audio waveform refinements with `wavesurfer.js`
- image processing with `sharp`
- video clips and contact sheets with `ffmpeg`
- OCR later

Those capabilities stay future work and should remain manifest-governed before integration.

## Workbench Role

The Spectra Workbench reads this preview metadata to show:

- preview available/unavailable status
- preview kind
- preview source
- preview risk notes
- preview capability hooks for future tooling

## Beam Extraction Candidates

- attachment preview contract pattern
- safe preview route checklist
- browser-native-before-library pattern
- no arbitrary file read rule
- preview capability staging pattern

## Sidecar Boundary

The explicit-file sidecar subsystem remains closed and unchanged. Preview work does not change sidecar semantics, planning, approval gating, or write execution.
