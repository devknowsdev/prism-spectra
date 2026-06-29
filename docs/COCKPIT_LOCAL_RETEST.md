# Cockpit Local Retest

Use this after pulling `spectra-project-cockpit-20260629`.

```bash
cd ~/Desktop/prism-spectra
git fetch origin
git checkout spectra-project-cockpit-20260629
git pull --ff-only
npm install
npm run test:cockpit

lsof -tiTCP:3000 -sTCP:LISTEN | xargs -r kill

AI_FORGE_AI_GATEWAY_TOKEN="dev-local-token" \
AI_FORGE_MOCK_EXECUTORS=1 \
npm run cockpit
```

Open:

```text
http://127.0.0.1:3000/cockpit
```

Use gateway token:

```text
dev-local-token
```

Then hard-refresh the page:

```text
Cmd + Shift + R
```

If DevTools still shows errors from `contentscript.js` or `content_scripts.js`, test once in an incognito/private window with extensions disabled. Those messages are browser-extension scripts, not the Spectra cockpit page.

The important error to check for is any remaining line beginning with `cockpit:`.
