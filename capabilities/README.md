# Spectra Capability Manifests

This directory contains the Beam-approved JSON capability registry for Spectra.
Each `*.json` file is one capability manifest validated against
`schemas/capability.schema.json`.

Slice 1 is observe-only:

- invalid manifests fail closed and are not registered;
- an absent directory degrades to current behavior with a startup warning;
- unmanifested AI request intents are not rejected in slice 1;
- reserved-domain entries stay inert with `status: "reserved"` and
  `disabledByDefault: true`.

Run:

```bash
npm run capabilities:check
```
