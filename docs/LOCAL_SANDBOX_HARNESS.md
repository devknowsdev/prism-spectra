# Local Sandbox Harness

Sprint 032 adds a disposable sandbox for fuller end-to-end testing of Prism Spectra runtime and workbench behavior.

## Goal

- Use fixture files and temporary directories only.
- Stay inside the repository sandbox.
- Avoid real user folders, external services, and hidden background work.
- Keep the harness deterministic so it can be reset and reseeded quickly.

## Layout

- `sandbox/fixtures/` holds tracked, tiny fixture files.
- `sandbox/tmp/` holds generated runtime data only.
- `sandbox/.gitignore` keeps generated sandbox output out of version control.

## Scripts

- `npm run sandbox:reset` removes and recreates `sandbox/tmp/`.
- `npm run sandbox:seed` resets the sandbox and copies the tracked fixtures into `sandbox/tmp/`.

Both scripts refuse to operate outside the repository sandbox paths they are responsible for.

## What the sandbox can test now

- Local filesystem adapter reads against seeded files.
- Path-escape rejection from the sandbox temp root.
- Deterministic file seeding and reset behavior.
- Attachment and metadata fixture handling without touching real user folders.

## Safety guarantees

- No external APIs are called.
- No real home-directory folders are scanned.
- No Docker or remote services are involved.
- No destructive file operations are exposed to the harness.
- No media analysis, transcription, FFmpeg, Whisper, or watchers are added.

## What remains manual

- Browser-driven workbench interactions still need a real browser runner for automatic coverage.
- This sprint does not add Playwright or another e2e framework.

## Recommended next step

Add a minimal Playwright smoke test that opens the workbench, runs the sandbox seed, and verifies the calm attachment flows in a browser. That should remain a separate sprint so the harness stays narrow and local-first.
