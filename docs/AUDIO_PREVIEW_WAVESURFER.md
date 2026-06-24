# Audio Preview with wavesurfer.js

Sprint 031 adds a lazy waveform preview path for supported local audio attachments in the Spectra Workbench.

## Scope

- Uses `wavesurfer.js` for browser-based waveform rendering.
- Loads waveform code only after explicit user action.
- Reuses the safe attachment preview route from Sprint 030.
- Keeps the preview local, read-only, and non-autoplaying.
- Does not add transcription, analysis, editing, export, FFmpeg, whisper.cpp, or destructive controls.
- Does not add arbitrary local file serving.

## Local-only model

- The browser requests the attachment through `GET /api/v1/workbench/attachments/:id/preview`.
- The daemon still owns path safety and attachment ownership checks.
- The waveform exists only in the browser while the preview is open.
- There is no stored waveform artifact, cached transcription, or derived media file.

## User-action gate

- The workbench shows a `Load waveform preview` button for supported audio attachments.
- Nothing loads automatically when an attachment is selected.
- `wavesurfer.js` is imported only after that explicit click.
- The preview stays paused until the user presses play.

## Guardrails

- No autoplay.
- No transcription.
- No audio analysis.
- No FFmpeg.
- No whisper.cpp.
- No microphone access.
- No waveform editing.
- No export.
- No source-file mutation.

## Safety notes

- The preview route remains attachment-id based and path-safe.
- The browser preview is only available for attachments the daemon can safely serve.
- Large audio files may use more memory while wavesurfer.js decodes them in the browser.
- If a local attachment is unavailable through the safe preview route, the UI should keep the preview unavailable instead of weakening the route.

## How it plugs in

- `src/workbench/attachments.ts` classifies local audio attachments with the `wavesurfer.audio.preview` capability hook.
- `src/capabilities/manifest.ts` marks the capability as local-only, observe-only, lazy-loaded, and preview-focused.
- `ui/workbench/index.html` renders the lazy waveform controls and destroys the preview instance when the attachment changes or closes.
- `tools/daemon.ts` continues to serve bytes only through the safe preview route.

## Future work

- Regions and bookmarks, if they stay local-only and explicit.
- Waveform caching, if memory pressure ever justifies it.
- Transcript alignment, but only after a separate transcription path exists.
- Transcription with `whisper.cpp` later, if approved.
- Audio analysis later, if it remains narrow and local.

## Beam extraction candidates

- lazy rich-preview integration pattern
- user-action-before-heavy-preview rule
- audio preview safety checklist
- browser-native-to-specialized-preview progression
- no-autoplay media rule
