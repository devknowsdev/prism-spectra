# Spectra Guided Coding Layer

Last updated: 2026-06-29

## Purpose

The Spectra cockpit should not feel like a wall of terminals. It should become a guided coding and maintenance layer for the Prism suite.

The intended operator may be:

- Dave, clicking visible actions.
- ChatGPT, telling Dave exactly which visible action to take.
- A future Spectra AI assistant, selecting from approved actions under explicit review boundaries.

The cockpit should therefore present state, intention, and next actions before it presents raw process controls.

## Product direction

The cockpit should evolve from:

```text
Process cards first
```

to:

```text
Guided mission first → next safe action → checklist → advanced process cards
```

The advanced cards should still exist, but they should sit below the guided layer.

## Primary screen structure

### 1. Mission banner

Shows the current workflow in plain language.

Example:

```text
Mission: Focus ↔ Spectra bridge validation
Mode: mock gateway
Goal: safely test Focus AI through Spectra without hidden writes
```

### 2. Next best action

A single highlighted action based on current state.

Examples:

```text
Start Focus UI from cockpit
Run Spectra validation
Open Focus and test Settings → AI → Test Spectra
Stop the existing external Focus server in Terminal before cockpit ownership
```

This should be the first thing a non-initiated user sees.

### 3. Readiness checklist

A calm checklist with four stages:

1. Spectra gateway is running.
2. Focus UI is running and ownership is clear.
3. Validation has run.
4. Focus bridge test is ready.

Each item should use plain language and avoid assuming terminal knowledge.

### 4. Role cards

The current role cards should move into an advanced section.

Role cards remain useful for AI/coding operators, but they should not be the first interface shown to Dave.

## Ownership model

The cockpit must distinguish between:

- Cockpit-owned process.
- External process on the expected port.
- No process.
- Reserved future interface.

If a process is external, the cockpit should not present browser-based destructive actions. It should explain what is happening and tell the operator to stop the existing process in Terminal if cockpit ownership is required.

## AI interaction model

The Spectra AI should eventually interact with this layer through structured actions, not free-form shell commands.

A future action packet should look conceptually like:

```json
{
  "workflow": "focus-spectra-bridge",
  "role": "focus-ui",
  "action": "start",
  "requiresApproval": true,
  "reason": "Focus is not running and the next validation step requires the browser app."
}
```

The UI should show the action and reason before execution.

## Vibe-coder and Prism Build placement

The cockpit should reserve launch surfaces for:

- Vibe-Coder CLI.
- Prism Build.

These should not be built as raw terminals first. They should begin as guided launch cards with clear ownership, repo, branch, command preview, and review gates.

## Immediate implementation slices

### Slice 1: Guided banner and checklist

Add a top-level guided panel above the current role cards.

Inputs:

- Gateway health.
- Focus health.
- Focus ownership state.
- Validation logs presence.
- Gateway mode.

Output:

- Mission.
- Current state summary.
- Next best action.
- Four-step readiness checklist.

### Slice 2: Safer process ownership text

Fix confusing process ownership labels.

Rules:

- Do not show PID `0`.
- Only show positive integer PIDs.
- For external processes, show `external process` or `external healthy` without pretending the cockpit owns it.
- Hide browser-based destructive controls for external processes.

### Slice 3: AI action schema

Define the approved action schema used by future Spectra AI.

Initial actions:

- refresh status
- start role
- stop cockpit-owned role
- run validation
- open linked app
- show logs

Do not include free-form shell execution in the first schema.

### Slice 4: Guided Prism Build card

Turn Prism Build from a placeholder into a guided card with no execution until the build contract is defined.

### Slice 5: Guided Vibe-Coder card

Turn Vibe-Coder CLI from a placeholder into a launch-review card, not a raw shell.

## Safety defaults

- No hidden writes.
- No browser-based destructive action against external processes.
- No free-form terminal field in the first guided layer.
- Commands must be visible before execution.
- AI suggestions must require explicit approval.
- Repo, branch, cwd, and port must be visible before action.

## Desired user experience

A non-initiated user should be able to read the top panel and know:

```text
What are we doing?
What is already running?
What is safe to do next?
What should I not touch?
Where do I go if I need advanced controls?
```

The advanced process cards should support expert operation, but the guided layer should support calm collaboration between Dave and an AI assistant.
