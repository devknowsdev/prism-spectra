#!/usr/bin/env -S tsx
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetSandboxTmp } from "./sandbox-paths.js";

export { resetSandboxTmp } from "./sandbox-paths.js";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = resetSandboxTmp();
  console.log(`sandbox reset: ${result.tmpDir}`);
}
