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
Settings -> AI -> Spectra AI gateway
```

Use:

```text
URL:   http://127.0.0.1:3000
Token: dev-local-token
```

Click `Test Spectra`. The test performs a health check and one read-only AI
request. It should report the provider, model, and data boundary.

## Safety notes

- Keep Focus helpers routed through `src/ai_spectra_bridge.js`.
- Keep `/api/v1/ai/request` read-only until higher-risk approval flows are added.
- Do not add app-local provider routing to Focus.
- Do not put runtime AI calls in Beam.
- Mock mode is for proving the bridge; real local mode requires Ollama running.
