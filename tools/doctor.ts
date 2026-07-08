#!/usr/bin/env -S tsx
/*
  Prism Spectra setup doctor.

  This command is intentionally read-only. It checks local prerequisites and
  prints setup guidance without creating config, starting watchers, publishing,
  scanning user folders, or executing app workflows.
*/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { checkAllCloudTeacherHealth } from "../src/eval/cloudTeacherProviders.js";

const MIN_NODE_MAJOR = 22;

type CheckStatus = "ok" | "warn" | "info";

type Check = {
  status: CheckStatus;
  label: string;
  detail: string;
};

const args = new Set(process.argv.slice(2));
const showSetupGuide = args.has("--setup-guide") || args.has("--setup") || args.has("setup");

async function main(): Promise<void> {
  const root = process.cwd();
  const checks = await collectChecks(root);

  console.log("\nPrism Spectra setup doctor\n");
  for (const check of checks) {
    console.log(`${icon(check.status)} ${check.label}`);
    console.log(`   ${check.detail}`);
  }

  const warnings = checks.filter((check) => check.status === "warn").length;
  console.log(`\nSummary: ${checks.length - warnings}/${checks.length} checks OK or informational, ${warnings} warning${warnings === 1 ? "" : "s"}.`);

  if (showSetupGuide) {
    printSetupGuide();
  } else {
    console.log("\nNext safe commands:");
    console.log("  npm install");
    console.log("  npm run doctor");
    console.log("  npm run typecheck");
    console.log("  npm test");
    console.log("  npm run build");
    console.log("\nFor setup guidance: npm run setup");
  }

  console.log("\nSafety note: doctor/setup do not write config, start daemons, scan folders, publish, or execute graphs.\n");
}

async function collectChecks(root: string): Promise<Check[]> {
  const checks: Check[] = [];

  checks.push(checkNodeVersion());
  checks.push(checkPackageJson(root));
  checks.push(checkNodeModules(root));
  checks.push(checkTypeScriptConfig(root));
  checks.push(checkDaemonSource(root));
  checks.push(checkWorkbenchShell(root));
  checks.push(checkLocalTokenEnv());
  checks.push(checkProviderEnv());
  checks.push(await checkCloudTeacherProviders());
  checks.push(checkGit(root));
  checks.push(checkDemoDirs(root));

  return checks;
}

function checkNodeVersion(): Check {
  const version = process.versions.node;
  const major = Number(version.split(".")[0]);
  if (major >= MIN_NODE_MAJOR) {
    return { status: "ok", label: "Node version", detail: `Node ${version} satisfies >=${MIN_NODE_MAJOR}.` };
  }
  return { status: "warn", label: "Node version", detail: `Node ${version} detected; package requires >=${MIN_NODE_MAJOR}.` };
}

function checkPackageJson(root: string): Check {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) {
    return { status: "warn", label: "package.json", detail: "Not found in the current directory. Run from the prism-spectra repo root." };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts || {};
    const required = ["typecheck", "test", "build", "forge", "start", "doctor", "setup"];
    const missing = required.filter((name) => !scripts[name]);
    if (missing.length === 0) {
      return { status: "ok", label: "package scripts", detail: `Required scripts found: ${required.join(", ")}.` };
    }
    return { status: "warn", label: "package scripts", detail: `Missing scripts: ${missing.join(", ")}.` };
  } catch (error) {
    return { status: "warn", label: "package.json", detail: `Could not parse package.json: ${(error as Error).message}` };
  }
}

function checkNodeModules(root: string): Check {
  const dir = path.join(root, "node_modules");
  if (fs.existsSync(dir)) {
    return { status: "ok", label: "dependencies", detail: "node_modules exists." };
  }
  return { status: "warn", label: "dependencies", detail: "node_modules not found. Run npm install before typecheck/test/build." };
}

function checkTypeScriptConfig(root: string): Check {
  const files = ["tsconfig.json", "tsconfig.test.json", "tsconfig.build.json"];
  const missing = files.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length === 0) {
    return { status: "ok", label: "TypeScript configs", detail: `${files.join(", ")} present.` };
  }
  return { status: "warn", label: "TypeScript configs", detail: `Missing: ${missing.join(", ")}.` };
}

function checkDaemonSource(root: string): Check {
  const daemonPath = path.join(root, "tools", "daemon.ts");
  if (!fs.existsSync(daemonPath)) {
    return { status: "warn", label: "daemon", detail: "tools/daemon.ts not found." };
  }
  return { status: "ok", label: "daemon", detail: "tools/daemon.ts present. Launch manually with npm run workbench when needed." };
}

function checkWorkbenchShell(root: string): Check {
  const html = path.join(root, "ui", "workbench", "index.html");
  const docs = path.join(root, "docs", "SPECTRA_WORKBENCH_SHELL.md");
  const missing = [html, docs].filter((file) => !fs.existsSync(file));
  if (missing.length === 0) {
    return { status: "ok", label: "workbench shell", detail: "Workbench HTML and shell doc are present." };
  }
  return { status: "warn", label: "workbench shell", detail: `Missing ${missing.map((file) => path.relative(root, file)).join(", ")}.` };
}

function checkLocalTokenEnv(): Check {
  const token = process.env.AI_FORGE_DAEMON_TOKEN || process.env.LOCAL_AI_TOKEN;
  if (token) {
    return { status: "ok", label: "local daemon token", detail: "AI_FORGE_DAEMON_TOKEN or LOCAL_AI_TOKEN is set for this shell." };
  }
  return { status: "info", label: "local daemon token", detail: "No local token env var set. The daemon will generate an ephemeral token at launch." };
}

function checkProviderEnv(): Check {
  const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OLLAMA_HOST"];
  const present = keys.filter((key) => !!process.env[key]);
  if (present.length > 0) {
    return { status: "ok", label: "provider environment", detail: `Detected: ${present.join(", ")}.` };
  }
  return { status: "info", label: "provider environment", detail: "No provider env vars detected. CLI status can still explain provider setup." };
}

async function checkCloudTeacherProviders(): Promise<Check> {
  const health = await checkAllCloudTeacherHealth();
  const ok = health.filter((item) => item.ok).map((item) => item.provider);
  const missing = health.filter((item) => item.status === "missing-key").map((item) => item.provider);
  const failed = health.filter((item) => item.status === "auth-failed").map((item) => `${item.provider}: ${item.reason ?? "auth ping failed"}`);

  if (failed.length > 0) {
    return { status: "warn", label: "cloud-teacher providers", detail: `Auth ping failed for ${failed.join("; ")}.` };
  }
  if (ok.length > 0) {
    return { status: "ok", label: "cloud-teacher providers", detail: `Auth ping OK for ${ok.join(", ")}; missing keys for ${missing.join(", ") || "none"}.` };
  }
  return { status: "info", label: "cloud-teacher providers", detail: `No cloud-teacher provider keys present (${missing.join(", ")}). Explicit eval/teacher dispatch will fail closed.` };
}

function checkGit(root: string): Check {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf-8" });
  if (result.status === 0 && result.stdout.trim() === "true") {
    return { status: "ok", label: "git worktree", detail: "Current directory is inside a git worktree." };
  }
  return { status: "info", label: "git worktree", detail: "Git worktree not detected or git unavailable. Some checkpoint flows may need git." };
}

function checkDemoDirs(root: string): Check {
  const demo = path.join(root, ".demo");
  if (fs.existsSync(demo)) {
    return { status: "ok", label: "demo workspace", detail: ".demo exists for local harness/daemon experiments." };
  }
  return { status: "info", label: "demo workspace", detail: ".demo not present yet. Demo scripts may create or expect local fixture directories." };
}

function printSetupGuide(): void {
  console.log("\nSetup guide\n");
  console.log("1. Install dependencies:");
  console.log("   npm install");
  console.log("\n2. Re-run the read-only doctor:");
  console.log("   npm run doctor");
  console.log("\n3. Validate the developer build path:");
  console.log("   npm run typecheck");
  console.log("   npm test");
  console.log("   npm run build");
  console.log("\n4. Check provider availability without running a workflow:");
  console.log("   npm run forge -- --status");
  console.log("\n5. Launch the local workbench only when you are ready for a long-running daemon:");
  console.log("   npm run workbench");
  console.log("\n6. Keep approval boundaries explicit:");
  console.log("   - preview before execute");
  console.log("   - no broad scans by default");
  console.log("   - no hidden external writes");
  console.log("   - no destructive action without explicit approval");
}

function icon(status: CheckStatus): string {
  if (status === "ok") return "✓";
  if (status === "warn") return "!";
  return "i";
}

main().catch((error) => {
  console.error(`doctor failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
