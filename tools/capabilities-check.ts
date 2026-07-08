#!/usr/bin/env -S tsx

import { loadCapabilityManifestRegistry } from "../src/capabilities/capabilityManifestRegistry.js";

const directory = process.argv[2];
const result = loadCapabilityManifestRegistry({ directory, warnOnMissing: true });

if (result.missing) {
  console.warn(`[capabilities:check] manifest directory is absent: ${result.directory}`);
  process.exitCode = 0;
} else if (result.issues.length > 0) {
  console.error(`[capabilities:check] ${result.issues.length} invalid manifest file(s); ${result.loaded.length} valid manifest(s) loaded`);
  for (const issue of result.issues) {
    console.error(`- ${issue.filePath}`);
    for (const error of issue.errors) {
      console.error(`  - ${error}`);
    }
  }
  process.exitCode = 1;
} else {
  console.log(`[capabilities:check] ok: ${result.loaded.length} manifest(s) loaded from ${result.directory}`);
}
