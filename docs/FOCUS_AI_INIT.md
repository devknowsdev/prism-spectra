# Focus AI Initialisation

Last-Updated: 2026-06-27

## Purpose

This is the practical start path for making Prism Focus use Spectra as the suite
AI engine.

The architecture boundary remains:

```text
Focus feature -> Focus AiAdapter -> Spectra /api/v1/ai/request -> Spectra provider routing -> Focus review UI
```

Focus owns task/planner state. Spectra owns provider routing/model selection.
The first Focus integration is read-only and must not mutate Focus state.

## Expected user-facing behaviour

The setup should be understandable from inside Focus without needing an AI
assistant to explain it.

Focus Settings -> AI now includes a `Spectra AI gateway` panel and a five-step
setup wizard:

1. Understand what Focus AI does.
2. Connect Spectra.
3. Test the connection.
4. Use AI in Focus.
5. Troubleshoot common failures.

The wizard explains that a browser app cannot silently start a local Node/Ollama
process. It therefore gives the safest near-button-driven path: save defaults,
copy or download a launcher, keep the Spectra terminal window open, then test
from inside Focus.

## Start Spectra for Focus

From the `prism-spectra` repo:

```bash
npm install
AI_FORGE_AI_GATEWAY_TOKEN="dev-local-token" npm run ai:gateway
```

This starts the dedicated AI gateway on:

```text
http://127.0.0.1:3000/api/v1
```

If no token is supplied, the gateway prints an ephemeral token at startup.

## Mock mode versus real local AI

The gateway defaults to mock executors so the Focus bridge can be tested without
Ollama or paid/cloud providers.

To use real local Ollama routing:

```bash
AI_FORGE_AI_GATEWAY_TOKEN="dev-local-token" AI_FORGE_MOCK_EXECUTORS=0 npm run ai:gateway
```

Useful optional environment variables:

```text
OLLAMA_HOST
OLLAMA_CODER_MODEL
OLLAMA_GENERAL_MODEL
```

## Smoke test from Spectra

With the gateway running in another terminal:

```bash
AI_FORGE_AI_GATEWAY_TOKEN="dev-local-token" npm run test:focus-ai
```

The smoke test calls:

```text
GET  /api/v1/health
POST /api/v1/ai/request
```

It uses `sourceApp=prism-focus`, `riskClass=read-only`, and `record=false`.

## Connect Focus

From the `prism-focus` repo:

```bash
python3 -m http.server 8080
```

Then open Focus in the browser and go to:

```text
Settings -> AI -> Spectra AI gateway -> Open AI setup wizard
```

The intended browser flow is:

1. Click `Use dev defaults`.
2. Click `Copy mock command` or `Download launcher`.
3. Start/keep open the Spectra terminal window.
4. Click `Test Spectra`.
5. Enable AI features.
6. Try daily plan suggestion, journal interpretation, or task parsing.

A successful test should show:

```text
Connected
provider: ...
model: ...
data: local / external
```

If mock mode is active, Focus should explicitly say the bridge is working but
answers are test responses.

## Safety notes

- Keep Focus helpers routed through `src/ai_spectra_bridge.js`.
- Keep `/api/v1/ai/request` read-only until higher-risk approval flows are added.
- Do not add app-local provider routing to Focus.
- Do not put runtime AI calls in Beam.
- Mock mode is for proving the bridge; real local mode requires Ollama running.

## Product follow-up

A true one-click local AI experience will need a packaged local helper app,
Electron/Tauri shell, LaunchAgent, or signed macOS launcher. A static browser app
can copy commands, download helper scripts, and test localhost, but should not
pretend it can safely start background local processes by itself.
