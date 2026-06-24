# Uppy Attachment Ingest

Sprint 028 adds a narrow, local-only attachment ingest capability to the Spectra workbench.

## Scope

- Uses `@uppy/core` and `@uppy/drag-drop` for local file selection and calm preview.
- Does not add Companion, remote providers, folder scanning, media processing, AI analysis, or destructive actions.
- Does not change the explicit-file sidecar subsystem.
- Does not introduce database migrations or new persistence models.

## Flow

1. The workbench opens the local ingest panel.
2. A user selects one local file in the drag-and-drop picker.
3. The file is previewed in the UI.
4. The user clicks `Import`.
5. The daemon stores the attachment record locally and emits provenance events.

That explicit `Import` click is the approval moment for this sprint.

## Manifest Gate

The `uppy.attachment.ingest` manifest remains the guardrail for this capability.

- `loadMode`: `lazy`
- `approvalClass`: `write`
- `checkpointPolicy`: `before_write`
- `localOnly`: `true`
- `remoteOptional`: `false`
- `remoteRequired`: `false`
- `sendsUserDataOffMachine`: `false`

## Daemon Behavior

The new local ingest route:

- accepts `filename`, `contentBase64`, `contentType?`, and `conversationId?`
- validates the payload before writing anything
- writes only local attachment bytes
- stores the attachment row in the existing attachments table
- records a local audit entry
- appends ledger events for opened, previewed, observed, written, and completed states

No approval execution or capability execution is added beyond that explicit import action.

## UI Behavior

The workbench UI now shows:

- an `Add local attachment` affordance
- a preview queue for selected files
- an explicit `Import` button
- a clear empty state when nothing is queued

The screen stays calm and read-only until the user chooses to import a local file.

## Beam Extraction Candidates

Potential future Beam candidates from this sprint:

- local attachment ingest flow pattern
- explicit preview-then-import UX pattern
- manifest-gated local capability pattern
- read-only-before-write UI pattern
- provenance events for local attachment import
- repo hygiene and sprint prompt conventions for capability work

## Future Work

Later sprints can add:

- better preview surfaces
- richer attachment metadata
- approval-gated write actions
- focused import history views
- stronger command mirror integration

Those should happen without reopening the closed sidecar subsystem.
