# Local AI Bootstrap

Last-Updated: 2026-06-29

## Purpose

`tools/bootstrap-local-ai.sh` is the safe local setup path for Spectra's Ollama
models. It is intentionally explicit: it checks your local Ollama installation,
prints the model names and rough disk sizes, asks for confirmation, and only
then runs `ollama pull`.

It does not:

- read, write, or print API keys
- create or commit tokens
- start file watchers
- scan user folders
- call cloud model APIs
- download anything without an explicit `PULL` confirmation

## Required Local Models

Spectra currently selects Ollama models in `src/executors/ollama.ts`.

| Role | Env var | Spectra default | Notes |
| --- | --- | --- | --- |
| Coder | `OLLAMA_CODER_MODEL` / `OLLAMA_MODEL_CODER` | `qwen2.5-coder:7b` | Purpose-built coding model; roughly 4.7GB. |
| General / Planner / Reasoner | `OLLAMA_GENERAL_MODEL` / `OLLAMA_MODEL_PLANNER` / `OLLAMA_MODEL_REASONER` | `qwen3.5:9b` | Recommended long-context local reasoning model for M1 16GB; roughly 6.6GB. |
| Classifier / Fallback | `OLLAMA_MODEL_CLASSIFIER` / `OLLAMA_MODEL_FALLBACK` | `qwen3:1.7b` | Small local classifier/fallback model; roughly 1.4GB. |

`qwen3:9b` is intentionally not used. That tag does not exist in the Ollama
Qwen3 family; the 9B tag belongs to `qwen3.5:9b`.

## Run The Bootstrap

From the `prism-spectra` repo root:

```bash
bash tools/bootstrap-local-ai.sh
```

If you want to override the recommended general model for a smaller local run:

```bash
OLLAMA_GENERAL_MODEL=qwen3:8b bash tools/bootstrap-local-ai.sh
```

If your Ollama daemon is not on the default local URL:

```bash
OLLAMA_HOST=http://127.0.0.1:11434 bash tools/bootstrap-local-ai.sh
```

The script exits before pulling if:

- the `ollama` CLI is missing
- the Ollama daemon is unreachable
- the selected general model is the invalid `qwen3:9b` tag
- you do not type the exact confirmation word `PULL`

## Start Spectra Gateway

For Focus or another Prism client to call Spectra, start the AI request gateway:

```bash
npm run ai:gateway
```

The gateway now uses real executors by default. Use mock executors only when
explicitly requested:

```bash
AI_FORGE_MOCK_EXECUTORS=1 npm run ai:gateway
```

To intentionally use real local Ollama with explicit model overrides:

```bash
OLLAMA_GENERAL_MODEL=qwen3.5:9b OLLAMA_MODEL_CLASSIFIER=qwen3:1.7b npm run ai:gateway
```

Use a local token when you want a stable token across restarts:

```bash
AI_FORGE_AI_GATEWAY_TOKEN="choose-a-local-token" npm run ai:gateway
```

Do not commit local tokens.

## How Focus Connects

Focus should call Spectra through its local AI URL/token settings and
`AiAdapter`. Focus should not manage Ollama model pulls or keep a long-term
provider router of its own. Ollama remains a provider behind Spectra.

## Optional Cloud Fallback

Cloud provider keys are optional shell/session configuration for Spectra:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY
GOOGLE_API_KEY
```

Keep these values local. Do not commit `.env` files, local shell exports,
tokens, or copied key output.

## Related Commands

```bash
npm run doctor
npm run setup
npm run forge -- --status
npm run test:setup
```

These commands inspect and validate the local setup path. They do not replace
the explicit model bootstrap confirmation.

## Package Script Note

This branch keeps the bootstrap callable by direct shell path. A later local
commit can add an npm alias such as `local-ai:bootstrap` after reviewing package
script policy locally.
