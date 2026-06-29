# Prism Spectra Project Cockpit

Last updated: 2026-06-29

## Purpose

The Spectra Project Cockpit is a small local-first control surface for running the Prism Focus ↔ Spectra bridge without juggling unlabelled terminal tabs.

It is intentionally not a general-purpose terminal yet. The first version exposes role-wired, fixed commands with visible labels, working directories, ports, health state, and logs.

## Branch

Active implementation branch:

```text
spectra-project-cockpit-20260629
```

This branch is based on:

```text
focus-resource-status-20260629
```

## Start the cockpit

From the Spectra repo:

```bash
cd ~/Desktop/prism-spectra
git fetch origin
git checkout spectra-project-cockpit-20260629
npm install

AI_FORGE_AI_GATEWAY_TOKEN="dev-local-token" \
AI_FORGE_MOCK_EXECUTORS=1 \
npm run cockpit
```

Then open:

```text
http://127.0.0.1:3000/cockpit
```

The cockpit uses the same gateway token as the Focus bridge. The default local development token is:

```text
dev-local-token
```

## Current role cards

### Core runtime

- **Spectra Gateway**: shows the currently running gateway that serves the cockpit and Focus AI bridge.
- **Focus UI**: starts `python3 -m http.server 4173` from `~/Desktop/prism-focus`.

### Validation

- **Spectra Validation**: runs `npm run typecheck && npm run test:ai-request` in `~/Desktop/prism-spectra`.
- **Spectra Git State**: prints branch, short status, and recent commits for Spectra.
- **Focus Git State**: prints branch, short status, and recent commits for Focus.

### Local models

- **Ollama Status**: runs `ollama list` and `ollama ps` without starting inference.

### Future interfaces

- **Vibe-Coder CLI**: reserved placeholder. Not implemented yet.
- **Prism Build**: reserved placeholder. Not implemented yet.

### Reference layer

- **Beam Session Log**: read-only snapshot command for Beam progress markers. It does not write Beam logs.

## Safety boundary

The cockpit currently runs only preset commands. It does not expose a free-form terminal textbox.

This keeps the first version useful for the current workflow while avoiding accidental arbitrary shell execution from the browser.

The Focus UI card includes a **Kill port** action for port `4173`, because that was the immediate source of local testing confusion. The running Spectra gateway card does not expose a kill-port action for port `3000`, because killing that port from the cockpit would kill the cockpit itself.

## Environment overrides

Default repo paths assume Dave's current local layout:

```text
~/Desktop/prism-spectra
~/Desktop/prism-focus
~/Desktop/prism-beam
```

You can override them when starting the gateway:

```bash
PRISM_SPECTRA_DIR="/path/to/prism-spectra" \
PRISM_FOCUS_DIR="/path/to/prism-focus" \
PRISM_BEAM_DIR="/path/to/prism-beam" \
AI_FORGE_AI_GATEWAY_TOKEN="dev-local-token" \
AI_FORGE_MOCK_EXECUTORS=1 \
npm run cockpit
```

## What this deliberately does not do yet

- It does not launch a real Vibe-Coder CLI interface yet.
- It does not launch Prism Build yet.
- It does not create pull requests.
- It does not write Beam progress logs.
- It does not replace the Focus review-first AI bridge.

## Next implementation steps

1. Split the profile into a JSON-backed project profile file once the first hard-coded profile is validated locally.
2. Add a supervised real-gateway profile that uses fresh DB/workdir paths and current Ollama model env vars.
3. Add a Vibe-Coder CLI card with an explicit approval boundary.
4. Add Prism Build presets with review gates and no hidden writes.
5. Add terminal title/role export helpers for workflows still run outside the cockpit.
