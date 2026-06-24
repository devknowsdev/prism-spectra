---
Last-Updated: 2026-06-24

# Spectra Setup Guide

This guide makes `prism-spectra` easier to start safely. It is for first-run usability, not new orchestration behavior.

## Safety boundary

The setup and doctor paths are intentionally conservative.

They do not:

- write config files
- start watchers
- scan user folders
- publish or deploy
- send email
- execute graphs
- perform destructive actions
- call external model APIs

They only inspect the current repo and environment, then print guidance.

## First run

From the `prism-spectra` repo root:

```bash
npm install
npm run doctor
```

Then run the safe validation path:

```bash
npm run typecheck
npm test
npm run build
```

## Setup guide command

For a copyable checklist:

```bash
npm run setup
```

This prints the recommended order:

1. install dependencies
2. re-run doctor
3. typecheck/test/build
4. check provider availability
5. launch workbench only when ready
6. keep approval boundaries explicit

## Provider status

To inspect provider availability without running a workflow:

```bash
npm run forge -- --status
```

The CLI status path probes provider availability and prints the relevant environment variables.

Common variables:

```text
OLLAMA_HOST
OLLAMA_CODER_MODEL
OLLAMA_GENERAL_MODEL
GEMINI_API_KEY or GOOGLE_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
```

## Workbench launch

Launch the local daemon/workbench only when you are ready for a long-running local server:

```bash
npm run workbench
```

The daemon defaults to:

```text
Host: 127.0.0.1
Port: 3000
```

The daemon requires a local token for API calls. You can provide one with:

```bash
AI_FORGE_DAEMON_TOKEN="choose-a-local-token" npm run workbench
```

or:

```bash
LOCAL_AI_TOKEN="choose-a-local-token" npm run workbench
```

If no token is supplied, the daemon generates an ephemeral token at launch.

## Doctor checks

`npm run doctor` checks:

- Node version against the package `engines` requirement
- package scripts
- dependency installation state
- TypeScript config presence
- daemon source presence
- workbench shell/documentation presence
- local daemon token environment
- provider environment variables
- git worktree availability
- local `.demo` fixture presence

Warnings are setup guidance, not automatic failure.

## Approval and adapter posture

Until Spectra has a richer setup wizard, use this checklist before running workflows:

- Preview before execute.
- Keep mock executors on unless intentionally testing real execution.
- Keep external writes off unless explicitly reviewed.
- Treat provider API keys as sensitive shell/session configuration.
- Do not point Spectra at broad home/user folders for scanning.
- Do not run destructive actions without explicit approval and rollback expectations.
- Keep sidecar writes explicit-file only.

## Commands that are safe for setup validation

```bash
npm run doctor
npm run setup
npm run typecheck
npm test
npm run build
npm run forge -- --status
```

## Commands that require extra care

```bash
npm run demo
npm run sandbox:reset
npm run sandbox:seed
npm run workbench
npm run forge
```

These can create local fixture state, start a long-running process, or move beyond passive inspection. Use them deliberately.

## What future prompts can omit

Future prompts can reference this guide instead of restating the safe first-run command order, doctor/setup boundary, provider status command, workbench launch command, or approval checklist.

## Future work

Recommended next PR:

```text
Spectra-Setup-002 — interactive setup wizard
```

Possible scope:

- ask before creating local config
- explain provider choices in plain English
- print exact workbench URL and token source
- show approval/adapters checklist in the CLI
- validate sample config without executing workflows
