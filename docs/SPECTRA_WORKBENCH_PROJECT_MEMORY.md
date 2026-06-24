# Spectra Workbench Project Memory

Last-Updated: 2026-06-24

Sprint 027 added first-class Conversations and Attachments surfaces to the Spectra Workbench.

## What it is

- A read-only project-memory layer in the workbench.
- A calm surface for conversations, messages, attachments, checkpoints, and related summaries.
- A way to answer: what was I doing, what changed, and what is safe to review next?

## What it uses

- Existing daemon project-memory data.
- Read-only workbench projection routes.
- The current event ledger, approval queue, and capability manifest scaffolds.

## What it is not

- Not an upload or ingest sprint.
- Not Uppy.
- Not media processing.
- Not approval execution.
- Not capability execution.
- Not a graph canvas.
- Not a chat-first replacement.

## Current surfaces

- Resume
- Conversations
- Attachments
- Approvals
- Changes
- Capabilities
- Settings

## Future direction

- Add attachment ingest through Uppy later, after the manifest and approval gates are in place.
- Add preview surfaces for safe inspection before any write action.
- Add approval-gated write actions only when the contracts are ready.
- Add a focused project map later, but keep the current shell calm and sparse.
- Keep the explicit-file sidecar subsystem unchanged.

## Beam extraction candidates

- Project-memory workbench pattern.
- Conversations-as-memory pattern.
- Attachments-as-artifacts pattern.
- Read-only before write UI pattern.
- Empty-state discipline.
- No fake-real data rule.

