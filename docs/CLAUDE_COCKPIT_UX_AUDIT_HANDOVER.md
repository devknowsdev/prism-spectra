# Claude Handover — Spectra Guided Cockpit UX Audit

Last updated: 2026-06-29

## Repository and branch

Repository:

```text
devknowsdev/prism-spectra
```

Active branch:

```text
spectra-project-cockpit-20260629
```

Base branch for this slice:

```text
focus-resource-status-20260629
```

Do not open or recommend a Focus PR from this branch. This is a Spectra-side cockpit/prototype branch for local validation and UX audit.

## Why this exists

Spectra is intended to become Dave's local-first CLI AI superbrain interface for the Prism suite.

The broader product role is:

```text
conceptualise → plan → build → run → inspect → fix → upgrade → document → hand over
```

The immediate pain being solved is not abstract dashboarding. Dave currently has to:

```text
ask an AI for terminal commands
switch terminal windows
cd into different repos
start or stop servers
remember branches and ports
copy terminal output back into the AI chat
repeat
```

The cockpit is the first practical slice of a smoother loop:

```text
Dave / AI guidance → Spectra guided layer → visible approved CLI/process action → logs/state captured in one place → next recommendation
```

## Current implementation summary

The current cockpit is served by the Spectra gateway at:

```text
http://127.0.0.1:3000/cockpit
```

It currently renders role cards for:

- Spectra Gateway
- Focus UI
- Spectra Validation
- Spectra Git State
- Focus Git State
- Ollama Status
- Beam Session Log
- Vibe-Coder CLI placeholder
- Prism Build placeholder

It is intentionally not a free-form browser terminal.

Current relevant files:

```text
tools/ai-gateway.ts
tools/cockpit/projectCockpit.ts
docs/PROJECT_COCKPIT.md
docs/GUIDED_CODING_LAYER.md
docs/COCKPIT_LOCAL_RETEST_20260629.md
test/cockpit-html.test.ts
package.json
```

## Local start path

From the Spectra repo:

```bash
cd ~/Desktop/prism-spectra
git fetch origin
git checkout spectra-project-cockpit-20260629
git pull --ff-only
npm install
npm run test:cockpit
```

Start the cockpit gateway with the local dev token and mock executors:

```bash
AI_FORGE_AI_GATEWAY_TOKEN="dev-local-token" \
AI_FORGE_MOCK_EXECUTORS=1 \
npm run cockpit
```

Open:

```text
http://127.0.0.1:3000/cockpit
```

Token:

```text
dev-local-token
```

## Current UI diagnosis

The current UI proves the mechanism works, but it is still too close to a process manager.

It exposes useful technical facts too early:

- ports
- PIDs
- cwd
- command previews
- role cards
- running/stopped process state

Those facts are useful, but they should be secondary. The first experience should answer:

```text
What are we doing?
What is the suite state?
What is the next safe action?
Why should I take that action?
What will happen if I approve it?
Where are the advanced controls if needed?
```

## Desired product direction

The cockpit should evolve into a guided Prism maintenance console:

```text
Guided mission first
→ current state summary
→ next safe action
→ readiness checklist
→ advanced process cards
```

The advanced process cards should remain, but they should move below a guided layer.

The guiding product sentence is:

```text
Spectra is the local-first AI operations workbench for the Prism suite: a guided layer where Dave and AI collaborators can plan, run, inspect, maintain, and upgrade Prism through visible, approval-gated CLI and process actions, without losing context in scattered terminals.
```

## Key UX principles for audit

1. **State before controls**
   - Show what is running and why it matters before showing buttons.

2. **One recommended next action**
   - Do not make Dave infer the correct sequence from many cards.

3. **Explicit ownership**
   - A process can be cockpit-owned, externally owned, not running, or reserved.

4. **No hidden command execution**
   - Commands must be fixed/preset and visible before execution.

5. **No free-form terminal yet**
   - Raw terminal access belongs later, behind stronger approval boundaries.

6. **AI operates through structured actions**
   - ChatGPT, Claude, and future Spectra AI should recommend/select approved action packets, not invent shell commands silently.

7. **Advanced controls are available but secondary**
   - Role cards are useful for technical inspection, but not as the first user experience.

## Known issue: PID 0 bug

A local screenshot showed the Focus UI card displaying:

```text
external pid(s) 0
```

This is wrong. PID `0` should never be shown as a process owner.

Audit this code:

```text
tools/cockpit/projectCockpit.ts
function listeningPids(port: number)
```

The current likely bug is that empty output from the port lookup is converted into numeric `0`.

Desired rule:

```text
trim output
if empty, return []
split only non-empty lines/tokens
keep only positive integer PIDs
never display 0
```

Also audit browser display logic so it only renders PID badges when at least one positive integer PID exists.

## Safety issue discovered during local testing

A browser-based kill-port button is too risky for externally-owned processes.

The cockpit should never kill an externally-owned process from the browser. It may stop only a process it started and owns.

For externally-owned processes, the UI should explain:

```text
This is already running outside the cockpit. Use it as-is, or stop the existing server in Terminal if you want the cockpit to take ownership.
```

Avoid presenting destructive browser actions for external processes.

## What to audit

### 1. Information architecture

Audit whether the current role-card layout should be restructured as:

- Mission banner
- Current state summary
- Next best action
- Readiness checklist
- Advanced controls

### 2. Guided workflow logic

Define the state machine for the Focus ↔ Spectra bridge workflow.

Suggested states:

```text
Gateway unavailable
Gateway ready, Focus stopped
Gateway ready, Focus external
Gateway ready, Focus cockpit-owned
Validation not run
Validation running
Validation passed
Validation failed
Bridge test ready
Bridge test result available
```

### 3. AI action model

Recommend an action packet schema for future AI interaction.

Example shape:

```json
{
  "workflow": "focus-spectra-bridge",
  "role": "focus-ui",
  "action": "start",
  "requiresApproval": true,
  "risk": "low",
  "reason": "Focus is not running and the next validation step requires the browser app.",
  "commandPreview": "python3 -m http.server 4173"
}
```

Do not include arbitrary shell execution in the first schema.

### 4. Neurodivergent-friendly UX

Audit for:

- cognitive load
- sequencing
- visual hierarchy
- panic/confusion states
- calm language
- reduction of terminal-switching burden
- ability to recover from mistakes

### 5. Vibe-Coder CLI and Prism Build placement

These should not start as raw terminal cards.

Audit how they should appear as future guided launch/review surfaces:

- clear purpose
- repo/branch/cwd
- command preview
- review boundary
- disabled until contract is defined

## Recommended first implementation slice after audit

Do not rewrite the whole cockpit.

Recommended small slice:

1. Fix the PID parser and display rules.
2. Add a top guided panel above the existing cards.
3. Add a `deriveCockpitGuidance(profile)` function that returns:
   - mission
   - current state summary
   - next recommended action
   - checklist items
4. Keep current cards underneath as `Advanced process controls`.
5. Add tests for:
   - PID parser returns no `0` for empty output
   - external Focus process disables browser destructive controls
   - guidance picks correct next action for mocked states

## Important constraints

- Do not broaden this into a generic dashboard.
- Do not add a raw browser terminal as the first step.
- Do not remove role cards; move them lower.
- Do not allow hidden writes.
- Do not allow AI to execute arbitrary shell commands.
- Do not recommend browser kill actions for external processes.
- Do not open a Focus PR unless local validation is clean.

## Desired Claude output

Please produce:

1. UX diagnosis of the current cockpit.
2. Proposed target layout.
3. State machine for the Focus ↔ Spectra workflow.
4. AI action schema recommendation.
5. Safety model.
6. Neurodivergent-friendly design recommendations.
7. Small staged implementation plan.
8. Exact first coder prompt for implementing the next slice.

## Repo URLs

Spectra:

```text
https://github.com/devknowsdev/prism-spectra
```

Focus:

```text
https://github.com/devknowsdev/prism-focus
```

Beam:

```text
https://github.com/devknowsdev/prism-beam
```

EPK:

```text
https://github.com/devknowsdev/EPK
```
