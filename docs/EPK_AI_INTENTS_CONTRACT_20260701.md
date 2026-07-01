# EPK AI Intents Contract — 2026-07-01

## Status

Docs-only contract for the currently implemented EPK Music/Career helpers.

This document records what `devknowsdev/EPK` already sends to Spectra through `/api/v1/ai/request`. It does not add a new Spectra feature, provider, model route, write path, schema migration, app cockpit, or cross-app state mutation.

## Source app

`EPK`

## Endpoint

```text
POST /api/v1/ai/request
```

Spectra remains the AI owner. EPK must not own provider/model routing.

## Shared request posture

All current EPK Music/Career helper requests must use:

```json
{
  "sourceApp": "EPK",
  "riskClass": "read-only",
  "preferredMode": "local-first"
}
```

Gateway expectations:

- Only `riskClass: "read-only"` is accepted.
- Terminal node execution is not accepted through this endpoint.
- Requests are wrapped as read-only AI requests with no app mutation and no file-write constraints.
- Output is a response for review by the calling app, not permission to publish, export, write files, mutate routes, send email, post to social platforms, or change Focus state.

## Implemented EPK intents

### 1. Biography copy refinement

```text
career.refine_epk_copy
```

Current fields:

- `bio.short`
- `bio.acoustic`
- `bio.full`

Behavior:

- Returns a visible draft suggestion.
- Caller may expose manual Apply only for already-editable local editor fields.
- No publish/export action is implied.

### 2. Offering and credit description refinement

```text
career.refine_epk_copy
```

Current fields:

- `offerings[n].description`
- `credits[n].description`

Behavior:

- Returns a visible draft suggestion.
- Caller may expose manual Apply only through the existing local editor/input path.
- No publish/export action is implied.

### 3. Copy consistency checking

```text
career.check_epk_copy_consistency
```

Current reviewed content:

- Biography copy
- offering titles, descriptions, and tags
- credit titles, roles, years, descriptions, and tags

Behavior:

- Returns findings only.
- No rewriting.
- No Apply.
- No source-field mutation.
- No publish/export action.

### 4. Promo Kit copy refinement

```text
career.refine_epk_promo_copy
```

Current reviewed content:

- generated Promo Kit Markdown brief

Behavior:

- Returns a visible draft suggestion only.
- No Apply button.
- No mutation of the generated source brief.
- No publish/export action.

### 5. Audience Page route-tag recommendations

```text
career.suggest_epk_route_tags
```

Current reviewed content:

- minimized route/page context
- public Biography content
- offering title/description/tag content
- credit title/role/year/description/tag content

Behavior:

- Returns recommendations only.
- No Apply button.
- No automatic tag change.
- No route mutation.
- No publish/export/download action.
- No Focus action.

## Data minimization expectations

EPK callers should send only the public or working copy needed for the helper.

Do not send:

- local Spectra tokens;
- GitHub tokens;
- private notes;
- contact endpoint secrets/configuration;
- raw full editor JSON when a minimized copy snapshot is enough;
- social/supporter/platform account data unless a future approved contract explicitly covers it.

## Out-of-scope behavior

These intents must not be interpreted as approval to add:

- social posting;
- supporter or mailing-list integrations;
- platform adapters;
- hidden emailing;
- hidden publishing/exporting;
- Focus task or schedule writes;
- route/tag mutation;
- EPK-local provider/model routing;
- a new Music/Career cockpit;
- a new repo.

## Suggested Spectra hardening tests

A future code PR should add focused tests that verify the gateway accepts the five current EPK read-only intents and preserves their provenance/constraints.

Minimum assertions:

- `normalizeAiRequestBody()` accepts each EPK intent with `sourceApp: "EPK"` and `riskClass: "read-only"`.
- The normalized request defaults to `preferredMode: "local-first"` and `nodeType: "docs"` where omitted.
- Non-read-only risk classes are rejected.
- `nodeType: "terminal"` is rejected.
- `buildAiRequestIntent()` includes the EPK source app, intent, minimized input, and context.
- `ExecutionEngine.runAiRequest()` wraps the request with `read-only`, `no-app-mutation`, and `no-file-write` constraints.
- Returned provenance preserves `sourceApp: "EPK"`, the read-only risk class, and the preferred mode.
- Executor patches are ignored for AI requests and never written to the work directory.

## Validation for this document

Docs-only change. No runtime code changed.
