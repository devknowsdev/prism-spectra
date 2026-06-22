# Continuation Handover

Date: 2026-06-22

## Current State

The workspace has been cleaned up and the AI UX in `prism-focus` is now much more consistent:
- AI plan entry uses an in-app composer modal.
- AI file-manager actions use inline drafts instead of browser prompts.
- Template saving now uses an inline name field.
- The task workflow tests currently pass in `prism-focus` at `350 passed, 0 failed`.

## Audit Findings

The audit uncovered three issues in `prism-spectra`:

1. `preview-node` is not safe-by-default.
   - `prism-focus` calls the daemon preview endpoint with `mockExecutors: false`.
   - The daemon honors that and can run real executors in a temp workspace.
   - Because the terminal executor really shells out, preview can still cause live side effects.

2. `mockExecutors: true` is not fully mock.
   - `buildExecutorRegistry()` still instantiates the real Claude executor in mock mode.
   - That means tests/demos can still make live API calls and incur cost.

3. Attachment download filenames are not safely encoded.
   - Upload/rename accepts arbitrary filenames.
   - The download route writes `Content-Disposition` directly from `row.filename`.

## Recommended Next Steps

1. Make preview safe by default.
   - Prefer mock executors for preview, or add an explicit separate "real preview" path with obvious warning text.

2. Replace Claude with a mock in mock mode.
   - Either add `ClaudeMockExecutor` or exclude Claude entirely when `AI_FORGE_MOCK_EXECUTORS=1`.

3. Encode attachment filenames in download headers.
   - Sanitize/escape `Content-Disposition` values before sending them.

## Verification Notes

- `npm test` in `prism-spectra` could not run in this environment because `tsc` is unavailable (`sh: tsc: command not found`).
- Static review only for the `prism-spectra` audit findings.
- `prism-focus` workflow tests were exercised and passed before handoff.

