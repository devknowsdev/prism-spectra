# Attachment Metadata and Tags

Sprint 029 hardens the local attachment path with a stable projection shape, simple local tags, and safe metadata updates.

## Local attachment metadata shape

Attachment records are projected with a calm local-first shape. Where available, they expose:

- `id`
- `originalName`
- `displayName`
- `mimeType`
- `sizeBytes`
- `sourceKind: local`
- `sourcePath` or a safe local reference
- `importedAt`
- `updatedAt`
- `tags`
- `metadata`
- `relatedConversationIds`
- `relatedCheckpointIds`
- `relatedEventIds`

The shape is stable for the workbench even when some optional fields are missing.

## Tag behavior

Tags remain local-only and non-destructive.

- tags are listed on attachment cards and in the attachment detail panel
- tags are normalized with trimmed whitespace
- internal whitespace collapses to single spaces
- duplicates are ignored
- empty tags are rejected
- tag mutations emit ledger events when the daemon path is used

## Safe metadata updates

The safe update surface is limited to display-name editing.

Allowed:

- `displayName`

Not allowed:

- source path mutation
- moving files
- deleting files
- raw metadata overwrite that breaks the schema
- binary or file-content changes

## What does not happen yet

This sprint does not add:

- delete
- move
- media preview
- thumbnailing
- EXIF parsing
- hashing, unless it already exists and is cheap
- remote providers
- folder scanning
- file watchers
- source-file writes
- media processing

## Ledger events emitted

Attachment metadata/tag work emits provenance events such as:

- `attachment.ingest.opened`
- `attachment.ingest.previewed`
- `attachment.ingest.completed`
- `attachment.tag.added`
- `attachment.tag.removed`
- `attachment.metadata.updated`

The workbench reads these events to keep the Changes timeline and Resume surface calm and accurate.

## UI behavior

The workbench Attachments screen now shows:

- display name and original name
- MIME type and size
- import time and update time
- tags with add/remove controls
- search and filter inputs for filename, tag, and MIME type
- a local-only boundary reminder
- import status and related provenance summaries

The UI stays read-only for destructive actions.

## Future work

Later sprints can add:

- thumbnails
- MIME sniffing / file-type detection
- richer previews
- compare / repair refinement
- attachment-to-conversation linking improvements
- safer remote metadata sync, if ever needed
- eventual Beam extraction

## Beam extraction candidates

Potential future Beam candidates from this pattern:

- attachment metadata schema pattern
- local tag normalization pattern
- non-destructive metadata edit pattern
- vendor-shim audit checklist
- local-only capability hardening checklist
