# Spectra Cockpit UX Test Plan

Last updated: 2026-06-29

## Purpose

This test plan evaluates whether the Spectra cockpit reduces terminal confusion and supports the broader goal of Spectra as a CLI AI superbrain interface for the Prism suite.

The current cockpit is not being tested as a generic dashboard. It is being tested as a guided local operations layer for Prism development and maintenance.

## Primary user problem

Dave currently loses time and energy by having to:

- ask an AI for terminal commands
- switch between terminal windows
- remember which repo and branch each command belongs to
- stop and start local servers manually
- copy terminal output back into the AI chat
- repeat the loop after every failure

The cockpit should reduce that loop.

## Test participants / modes

Test in three modes:

### 1. Dave-only mode

Dave uses the cockpit without AI guidance.

Question:

```text
Can Dave tell what to do next without needing to understand every process card?
```

### 2. AI-guided mode

ChatGPT or Claude tells Dave which visible cockpit action to take.

Question:

```text
Can the AI refer to visible, stable labels instead of giving raw terminal commands?
```

### 3. Future Spectra-AI mode

Imagine Spectra AI can recommend an approved action packet.

Question:

```text
Would this UI support a future AI saying: I recommend this action, here is why, approve?
```

## UX tasks to test

### Task 1: Understand current state

Starting from a loaded cockpit, ask:

- Is the Spectra gateway running?
- Is Focus running?
- Is Focus owned by the cockpit or external?
- Is the system in mock or real mode?
- What should happen next?

Success criteria:

- The user can answer without reading raw command strings first.
- External ownership is clearly explained.
- No fake PID such as `0` is displayed.

### Task 2: Hand Focus ownership to cockpit

Scenario:

- Focus is already running externally on port `4173`.

Expected UI:

- Shows `external process` or `external healthy`.
- Does not expose browser-based destructive controls for external processes.
- Explains that the existing server must be stopped in Terminal if cockpit ownership is desired.

Success criteria:

- User understands they can either use existing Focus or stop it manually first.
- User is not encouraged to click a risky browser kill button.

### Task 3: Start Focus from cockpit

Scenario:

- Focus is not running.

Expected UI:

- Recommended next action is Start Focus UI.
- Start button is visible.
- Command preview shows what will run.
- After start, card shows cockpit-owned running state.
- Stop is available only for cockpit-owned process.

### Task 4: Run validation

Scenario:

- Gateway and Focus are ready.

Expected UI:

- Recommended next action becomes Run Spectra validation.
- Validation command is visible.
- Logs are accessible.
- Failure output is captured in the cockpit.

### Task 5: Bridge test readiness

Scenario:

- Gateway ready.
- Focus reachable.
- Validation has been run.

Expected UI:

- Recommended next action is to open Focus and test Settings → AI → Test Spectra.
- UI reminds user that Focus remains review-first and proposals need approval.

### Task 6: Recover from gateway stopped

Scenario:

- Cockpit page is open but Spectra gateway on port `3000` is stopped.

Expected UI:

- Shows a calm connection-lost message.
- Explains that the Spectra gateway must be restarted from Terminal.
- Does not flood user with misleading role states.

## Audit checklist

### Information architecture

- Does the page start with mission/state/next action rather than raw process cards?
- Are advanced controls visually secondary?
- Is there one obvious next step?

### Language

- Does it avoid terminal jargon where possible?
- Does it explain external vs cockpit-owned process clearly?
- Does it avoid panic wording?

### Safety

- Are browser destructive actions hidden for external processes?
- Are commands visible before execution?
- Is there no free-form shell field?
- Are AI-controlled actions conceptualized as approved structured actions?

### Neurodivergent friendliness

- Is the user shielded from unnecessary details at first glance?
- Is sequencing clear?
- Is the current state stable and legible?
- Are recovery paths obvious?

### AI collaboration

- Can an AI say `Click Start Focus UI` or `Open Advanced process controls → Spectra Validation → Logs` using visible labels?
- Can the cockpit eventually expose action packets without changing the user mental model?

## Expected findings to resolve before merge

- PID `0` display bug must be fixed.
- Current role-card-first layout should be guided-panel-first.
- External process state should not show browser kill controls.
- Vibe-Coder and Prism Build should remain reserved until their action contracts are defined.

## Recommended UX test output format

For each finding, record:

```text
Finding:
Severity: low / medium / high
Evidence:
Recommended change:
Implementation slice:
Files likely affected:
Test needed:
```
