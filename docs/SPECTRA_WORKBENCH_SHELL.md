# Spectra Workbench Shell

Last-Updated: 2026-06-24

This is the first calm UI shell for Prism Spectra.

## What it is

- A UI shell only.
- A read-only workbench surface served by the existing daemon.
- A place to show resume, approvals, changes, capabilities, and settings without integrating heavy tools.

## What it is not

- Not a graph canvas.
- Not a plugin marketplace.
- Not a multimedia suite.
- Not a write workflow.
- Not a sidecar change.

## Data source

- The workbench reads capability manifest metadata from the daemon.
- The capability screen is intentionally manifest-driven so future UI layers can grow from the same schema.

## Current screens

- Resume
- Conversations
- Attachments
- Approvals
- Changes
- Capabilities
- Settings

## Future direction

- Connect approvals to real daemon state.
- Connect changes to provenance events and checkpoints.
- Connect conversations and attachments to richer project-memory views.
- Connect resume to actual project status.
- Keep sidecar behavior unchanged.
- Grow the shell incrementally rather than turning it into a generic dashboard.
