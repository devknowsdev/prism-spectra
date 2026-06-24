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
- `npm run test:browser` opens the workbench in a local Chrome session and checks the sandbox-seeded browser smoke path.

Both scripts refuse to operate outside the repository sandbox paths they are responsible for.

`npm run test:browser` prints one final status line:

- `browser smoke: ran and passed`
- `browser smoke: skipped: <reason>`
- `browser smoke: failed: <reason>`

The smoke only talks to `127.0.0.1`, so it stays local-first and does not contact external services.
If the environment blocks local socket binding, the smoke will skip with:

- `browser smoke: skipped: socket bind is not permitted in this environment`

On Dave's Mac, the same command should finish with `browser smoke: ran and passed` when Chrome and localhost binding are available.

## What the sandbox can test now

- Local filesystem adapter reads against seeded files.
- Path-escape rejection from the sandbox temp root.
- Deterministic file seeding and reset behavior.
- Attachment and metadata fixture handling without touching real user folders.
- A minimal browser smoke path that proves the workbench loads and does not eagerly request preview bytes for a selected sandbox attachment.
- A tiny browser audio positive path that synthesizes one local WAV in the smoke temp cwd, loads the safe preview route, and confirms the audio preview reaches a ready state.
- The browser smoke status line makes it obvious whether the run passed, skipped, or failed.

## Safety guarantees

- No external APIs are called.
- No real home-directory folders are scanned.
- No Docker or remote services are involved.
- No destructive file operations are exposed to the harness.
- No media analysis, transcription, FFmpeg, Whisper, or watchers are added.
- The browser smoke only uses localhost ports and a local Chrome session.

## What remains manual

- Rich browser e2e coverage still needs a broader test strategy.
- This smoke test does not verify waveform playback, visual regressions, or full attachment workflows.
- It does not need a committed audio fixture because the smoke synthesizes one tiny WAV in its own disposable temp tree.
- It uses the local Google Chrome app plus a tiny CDP runner, so the maintenance cost stays low without adding a browser dependency.

## Common Failure Causes

- Google Chrome is missing at the expected local path.
- The daemon cannot bind a local port in the current sandbox.
- The workbench stops rendering the seeded attachment row or preview boundary reminder.
- The smoke assertions fail because the UI behavior changed.
- If the sandbox says socket bind is not permitted, this is a local environment blocker rather than a browser harness bug.

## Recommended next step

Expand browser coverage only where it reduces repeated manual smoke work. The next useful addition would be a focused audio waveform browser check once a tiny fixture is worth carrying.
