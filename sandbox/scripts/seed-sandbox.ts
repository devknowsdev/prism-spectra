#!/usr/bin/env -S tsx
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedSandboxTmp } from "./sandbox-paths.js";

export { seedSandboxTmp } from "./sandbox-paths.js";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = seedSandboxTmp();
  console.log(`sandbox seeded: ${result.seededFiles.length} files`);
  for (const filePath of result.seededFiles) {
    console.log(`- ${filePath}`);
  }
}
