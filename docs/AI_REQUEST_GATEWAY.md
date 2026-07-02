# Spectra AI Request Gateway

Last-Updated: 2026-06-29

## Purpose

This document records the first implementation step for making `prism-spectra`
the suite AI engine for Prism.

The new AI request path is intentionally read-only. It gives client apps such as
`prism-focus` and `EPK` a way to ask Spectra for suggestions, parsing,
summaries, and drafts without giving those apps their own long-term provider
routers.

## Boundary

Spectra owns:

- provider routing
- model selection
- local Ollama access
- provider outcome learning
- provenance records
- future approval/checkpoint integration for higher-risk actions

Client apps own their own state:

- Focus owns tasks, planner state, local dashboard state, and review/import UI.
- EPK owns public/promotional truth and publisher output.
- Beam owns reference memory and contracts, not runtime AI calls.

## Endpoint

```http
POST /api/v1/ai/request
```

The endpoint is exposed by the dedicated gateway command:

```bash
npm run ai:gateway
```

The gateway defaults to:

```text
Host: 127.0.0.1
Port: 3000
```

The local token can be supplied with one of:

```bash
AI_FORGE_AI_GATEWAY_TOKEN="choose-a-local-token" npm run ai:gateway
AI_FORGE_DAEMON_TOKEN="choose-a-local-token" npm run ai:gateway
LOCAL_AI_TOKEN="choose-a-local-token" npm run ai:gateway
```

If no token is supplied, the gateway generates an ephemeral token at launch.

## Provider mode

The gateway now uses real executors by default. Mock executors are enabled only
when explicitly requested:

```bash
AI_FORGE_MOCK_EXECUTORS=1 npm run ai:gateway
```

When real executors are enabled, provider configuration follows the existing
Spectra provider environment variables, including:

```text
OLLAMA_HOST
OLLAMA_CODER_MODEL
OLLAMA_GENERAL_MODEL
OLLAMA_MODEL_CLASSIFIER
OLLAMA_MODEL_PLANNER
OLLAMA_MODEL_REASONER
OPENAI_API_KEY
ANTHROPIC_API_KEY
```

Current local defaults:

| Role | Default |
| --- | --- |
| Coder | `qwen2.5-coder:7b` |
| General / planner / reasoner | `qwen3.5:9b` |
| Classifier / fallback | `qwen3:1.7b` |

## Request shape

```json
{
  "sourceApp": "prism-focus",
  "intent": "daily-plan-suggestion",
  "riskClass": "read-only",
  "input": {
    "energy": 3,
    "scheduledCount": 2
  },
  "context": {
    "appSurface": "daily-plan"
  },
  "preferredMode": "local-first"
}
```

Current allowed `riskClass`:

```text
read-only
```

Non-read-only requests are rejected by the validator. This keeps the first
Spectra AI gateway safe for Focus/EPK suggestion flows before any mutation,
import, publish, file-write, or execution path is connected.

The currently implemented EPK request shapes and boundaries are recorded in
[`EPK_AI_INTENTS_CONTRACT_20260701.md`](./EPK_AI_INTENTS_CONTRACT_20260701.md).

## Response shape

```json
{
  "ok": true,
  "provider": "ollama",
  "model": "qwen3.5:9b",
  "dataBoundary": "local",
  "response": "...",
  "structuredResponse": null,
  "provenance": {
    "routedBy": "prism-spectra",
    "sourceApp": "prism-focus",
    "riskClass": "read-only",
    "preferredMode": "local-first",
    "graphId": "ai-request-prism-focus-...",
    "nodeId": "request",
    "recorded": true,
    "chainTried": []
  },
  "usage": {
    "tokensIn": 123,
    "tokensOut": 45,
    "cost": 0,
    "latencyMs": 50
  }
}
```

## Health check

```http
GET /api/v1/health
```

Returns service availability and whether mock executors are active.

## Validation

Run the focused contract test:

```bash
npm run test:ai-request
```

Run the setup-safe validation path:

```bash
npm run test:setup
```

## Implementation files

- `src/engine/aiRequest.ts`
- `src/engine/executionEngine.ts`
- `tools/ai-gateway.ts`
- `test/ai-request.test.ts`

## Current limitation

This first PR adds a dedicated AI gateway script instead of modifying the large
existing `tools/daemon.ts` workbench daemon. The connector used for this sprint
only supports whole-file replacements, and the current daemon is large enough
that a careful standalone gateway was safer than replacing the whole file.

A later refactor can fold `/api/v1/ai/request` into the workbench daemon after
local typecheck/tests are run.

## Next app sprint

After this endpoint is validated locally, the next app sprint should be:

```text
Focus-AI-Bridge-001 — route aiCall through AiAdapter/Spectra before legacy direct providers
```

Focus direct Ollama/Anthropic provider code should become an explicit legacy
fallback, then be removed after the Spectra path is comfortable.
