# Local AI Model Control

Last-Updated: 2026-06-25

## Purpose

This document records the first small control contract for button-driven local AI setup from Focus through Spectra.

The goal is to replace manual console rituals with clear controls:

```text
Focus Settings -> Spectra gateway -> Ollama model status / warm / unload
```

This is not a hidden background agent. The user still starts the local services intentionally, and model warm/unload actions are explicit button actions.

## Endpoints

All endpoints require the existing local gateway token header:

```http
x-local-token: <local token>
```

### `GET /api/v1/models/status`

Returns configured Spectra model readiness.

```json
{
  "ok": true,
  "ollamaHost": "http://127.0.0.1:11434",
  "mockExecutors": false,
  "models": [
    {
      "role": "general",
      "name": "qwen3:8b",
      "installed": true,
      "loaded": true
    },
    {
      "role": "coder",
      "name": "qwen2.5-coder:7b",
      "installed": true,
      "loaded": false
    }
  ],
  "installedModels": ["qwen3:8b", "qwen2.5-coder:7b"],
  "loadedModels": ["qwen3:8b"],
  "loadedStatusError": null
}
```

`loaded` is `null` if the installed Ollama version does not expose process status in a compatible way.

### `POST /api/v1/models/warm`

Warms a configured model by sending a tiny local generation request and asking Ollama to keep it loaded for a short period.

```json
{
  "role": "general"
}
```

Allowed roles:

- `general` -> `OLLAMA_GENERAL_MODEL`
- `coder` -> `OLLAMA_CODER_MODEL`

The endpoint intentionally rejects arbitrary model names. This prevents the UI from becoming a hidden model downloader or an unbounded model runner.

### `POST /api/v1/models/unload`

Requests Ollama to unload a configured model.

```json
{
  "role": "general"
}
```

This is best-effort. If Ollama cannot unload the model immediately, the UI should display the returned error rather than pretending it succeeded.

## Button UX

Focus should show a small Spectra/local AI control section in Settings:

- gateway status: reachable / unavailable / unauthorized
- configured model rows:
  - role
  - model name
  - installed indicator
  - loaded indicator where available
  - `Warm` button
  - `Unload` button
- a short note that warming can use RAM/CPU and unloading may save memory

## Automation policy

Future automation should be conservative:

- Do not silently download models.
- Do not silently start terminal/background processes from Focus.
- Do not silently keep large models hot all day.
- It is acceptable to auto-warm a configured model immediately before an explicit AI helper request if the user enabled that preference.
- It is acceptable to auto-unload after a quiet timeout if the user enabled that preference.

Recommended later preference names:

```text
spectraAutoWarmBeforeRequest: boolean
spectraAutoUnloadAfterIdleMins: number | null
```

## Boundaries

Spectra owns provider/model status and local Ollama control.
Focus owns UI buttons, user visibility, and confirmation.
Beam owns this contract and longer-lived setup guidance when promoted.
