import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
export const SANDBOX_DIR = path.resolve(REPO_ROOT, "sandbox");
export const SANDBOX_FIXTURES_DIR = path.resolve(SANDBOX_DIR, "fixtures");
export const SANDBOX_TMP_DIR = path.resolve(SANDBOX_DIR, "tmp");

const SANDBOX_KEEP_FILE = ".gitkeep";
const SANDBOX_SEED_FILES = [
  "attachments/text-attachment.txt",
  "metadata/example.json",
  "media/audio/README.md",
  "media/image/README.md",
] as const;

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertInsideSandbox(candidate: string, label: string, root = SANDBOX_DIR): string {
  const resolved = path.resolve(candidate);
  if (!isInsideRoot(root, resolved)) {
    throw new Error(`${label} must stay inside ${root}: ${resolved}`);
  }
  return resolved;
}

export function resolveSandboxTmpPath(...segments: string[]): string {
  return assertInsideSandbox(path.resolve(SANDBOX_TMP_DIR, ...segments), "sandbox/tmp path", SANDBOX_TMP_DIR);
}

export function ensureSandboxDirectories(): void {
  fs.mkdirSync(SANDBOX_FIXTURES_DIR, { recursive: true });
  fs.mkdirSync(SANDBOX_TMP_DIR, { recursive: true });
}

function seedFilePath(relativePath: string): { sourcePath: string; targetPath: string } {
  const sourcePath = assertInsideSandbox(path.resolve(SANDBOX_FIXTURES_DIR, relativePath), "sandbox fixture path", SANDBOX_FIXTURES_DIR);
  const targetPath = resolveSandboxTmpPath(relativePath);
  return { sourcePath, targetPath };
}

export function resetSandboxTmp(): { sandboxDir: string; tmpDir: string; keepFile: string } {
  const sandboxDir = assertInsideSandbox(SANDBOX_DIR, "sandbox directory");
  const tmpDir = assertInsideSandbox(SANDBOX_TMP_DIR, "sandbox tmp directory", sandboxDir);

  if (fs.existsSync(tmpDir)) {
    for (const entry of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
    }
  } else {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const keepFile = path.join(tmpDir, SANDBOX_KEEP_FILE);
  fs.writeFileSync(keepFile, "# Keeps sandbox/tmp present in git.\n", "utf8");

  return { sandboxDir, tmpDir, keepFile };
}

export function seedSandboxTmp(): { sandboxDir: string; tmpDir: string; seededFiles: string[] } {
  const { sandboxDir, tmpDir } = resetSandboxTmp();
  const seededFiles: string[] = [];

  for (const relativePath of SANDBOX_SEED_FILES) {
    const { sourcePath, targetPath } = seedFilePath(relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    seededFiles.push(targetPath);
  }

  return { sandboxDir, tmpDir, seededFiles };
}

export function getSandboxSeedRelativePaths(): readonly string[] {
  return SANDBOX_SEED_FILES;
}
