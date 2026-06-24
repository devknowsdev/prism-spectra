# Spectra Test Stabilization Notes

Last-Updated: 2026-06-24

## Purpose

This note records the current split between setup-safe validation and the full daemon e2e suite.

The goal is to prevent CI from hanging silently while preserving the full test harness for local/debug use.

## Current test surfaces

| Command | Purpose | CI status |
| --- | --- | --- |
| `npm run test:setup` | Safe setup validation: doctor, typecheck, and build. | Used by pull-request CI. |
| `npm test` | Full existing harness in `test/run.ts`. | Available for local/full validation. |
| `npm run test:full` | Alias for the full existing harness in `test/run.ts`. | Available for explicit full validation. |
| `npm run test:browser` | Workbench browser smoke test. | Separate explicit test surface. |

## Why this exists

During Spectra-Setup-001, the pull-request workflow ran successfully through:

```bash
npm ci
npm run doctor
```

Then the existing full test command appeared to remain in progress during the daemon e2e section of `test/run.ts`.

The relevant test is named:

```text
e2e: daemon execute-graph and rollback via API
```

That test spawns the local daemon, exercises workbench routes, upload/attachment routes, preview routes, execute-graph streaming, and rollback.

## Current CI policy

Pull-request CI uses:

```bash
npm ci
npm run test:setup
```

`test:setup` runs:

```bash
npm run doctor
npm run typecheck
npm run build
```

This validates the setup/developer build path without running the long daemon e2e harness.

## Full validation policy

Use the full harness deliberately when working on daemon, workbench, checkpoint, attachment, preview, execute-graph, rollback, or event-ledger behavior:

```bash
npm test
```

or:

```bash
npm run test:full
```

If the full test hangs, inspect the daemon e2e test first.

## Known stabilization target

Recommended next code-level stabilization:

```text
Spectra-Stabilization-002 — split daemon e2e into its own file with an abortable execute-graph stream
```

Likely scope:

- move the daemon e2e section out of `test/run.ts`
- add an explicit per-test timeout
- ensure the spawned daemon is always terminated in `finally`
- make the execute-graph stream reader abortable
- keep CI setup validation separate from local full e2e validation

## Safety boundary

This stabilization note does not weaken runtime safety behavior.

It only names which commands are appropriate for setup CI versus explicit daemon e2e work.
