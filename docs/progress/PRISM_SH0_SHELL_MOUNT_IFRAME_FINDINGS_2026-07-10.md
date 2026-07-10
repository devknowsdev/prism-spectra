# SH-0 Shell Mount Spike Findings — EPK Publisher Iframe

Date: 2026-07-10
Repo: `prism-spectra`
Scope: `AI_FORGE_SHELL_MOUNT=1` iframe mount of the existing EPK publisher app-preview.

## Runtime Setup

- Command: `AI_FORGE_DAEMON_PORT=3200 AI_FORGE_APP_PREVIEW=1 AI_FORGE_SHELL_MOUNT=1 npm run workbench`
- Daemon: `http://127.0.0.1:3200`
- Existing app-preview ports reported by the daemon:
  - Focus: `http://127.0.0.1:3201/`
  - EPK: `http://127.0.0.1:3202/`
- Mount endpoint response:

```json
[
  {
    "id": "epk-publisher",
    "label": "Mounted surface — EPK",
    "url": "http://127.0.0.1:3202/publisher/"
  }
]
```

The publisher entry path is `/publisher/`, served from the configured EPK preview root `../EPK/EPK/public` and resolved by the existing app-preview directory-index behavior to `publisher/index.html`.

## Flag-Off Check

With `AI_FORGE_SHELL_MOUNT` unset:

- `GET /api/v1/shell/mounts` returned `404`.
- The rendered workbench had the original 8 nav buttons only.
- No `epk-publisher` nav button rendered.
- No `iframe.shell-mount-frame` rendered.

## Iframe Render Result

With `AI_FORGE_APP_PREVIEW=1` and `AI_FORGE_SHELL_MOUNT=1`:

- The workbench rendered a ninth nav item: `Mounted surface — EPK`.
- `#epk-publisher` activated the mounted view.
- The mounted view body rendered a single iframe with `src="http://127.0.0.1:3202/publisher/"`.
- Screenshot: `/private/tmp/prism-sh0-shell-mount-evidence/epk-publisher-iframe-mounted-fresh.png`

Result: PASS. The EPK publisher rendered inside the Spectra workbench shell over same-daemon cross-port loopback.

## Function Check

The EPK publisher frame exposed its own controls. A visible in-frame control click kept the shell on `#epk-publisher` and the EPK publisher responded in-place, showing its live EPK data state.

- Screenshot after in-frame interaction: `/private/tmp/prism-sh0-shell-mount-evidence/epk-publisher-iframe-preview-coordinate-click.png`
- Browser console capture after the interaction: no warnings or errors.

Result: PASS for basic iframe-hosted interaction. No cross-frame messaging or shared state was added or required for this proof.

## Styling Isolation

Styling remained isolated:

- Spectra shell chrome kept its workbench styling.
- The iframe kept the EPK publisher's own dark olive/gold publisher styling.
- No Spectra token skin or workbench CSS leaked into the EPK surface.
- No EPK publisher styling leaked into the shell nav/topbar.

Result: PASS. Iframe isolation is doing useful work here.

## Console And Network Capture

Browser console:

- No `error`, `warning`, or `warn` entries were captured after mount render and in-frame interaction.

Network/header checks:

```text
GET http://127.0.0.1:3202/publisher/
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Cache-Control: no-store
Access-Control-Allow-Origin: *
```

```text
GET http://127.0.0.1:3202/publisher/publisher.css
HTTP/1.1 200 OK
Content-Type: text/css; charset=utf-8
Content-Length: 11909
Cache-Control: no-store
```

```text
GET http://127.0.0.1:3202/publisher/publisher.js
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Content-Length: 35329
Cache-Control: no-store
```

No `X-Frame-Options` or `Content-Security-Policy` / `frame-ancestors` header was present on the publisher response.

Result: PASS. No frame/CSP block was observed.

## Live Reload Check

The publisher HTML included the existing app-preview live-reload client:

```html
<script src="/preview/js/livereload.js"></script>
```

The live-reload client and SSE endpoint were reachable:

```text
GET http://127.0.0.1:3202/preview/js/livereload.js
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Content-Length: 320
Cache-Control: no-store
```

```text
GET http://127.0.0.1:3202/api/v1/preview/live
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache, no-store
Connection: keep-alive

: connected
```

No EPK file was edited to trigger a real reload, per the SH-0 boundary that prism-spectra must not touch EPK repo files or publish paths. The live-reload plumbing remains present and reachable inside the iframe.

Result: PASS for live-reload plumbing; file-change reload trigger intentionally not exercised.

## Boundary Notes

- No EPK repo files were touched.
- No EPK build or publish path was changed.
- No auth, PWA, Tauri, cross-frame messaging, shared state, re-skinning, second mount, or app-repo write path was added.
- Both EPK gates remain RED.

## Recommendation

Use iframe mounting for the next shell slice. For the current shell goal, iframe composition is sufficient: it renders the existing app unchanged, preserves style isolation, avoids repo coupling, and does not require shared build/runtime ownership. A heavier mechanism such as web components, build-time integration, or module federation is not warranted until a later slice needs deep shared state, shell-level command routing, or cross-surface component reuse.
