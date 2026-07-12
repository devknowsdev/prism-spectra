import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_DIRTY_FILES = 20;
const MAX_BUFFER = 1024 * 1024;
const GIT_TIMEOUT_MS = 5_000;

export interface ReadOnlyGitRepoStatus {
  name: string;
  path: string;
  branch: string | null;
  dirtyCount: number | null;
  dirtyFiles: string[];
  ahead: number | null;
  behind: number | null;
  tip: string | null;
  recent: string[];
  error?: string;
}

interface FixedRepo {
  name: string;
  path: string;
}

interface GitCommandResult {
  stdout: string;
}

function fixedRepos(daemonDir: string): FixedRepo[] {
  const repoRoot = path.resolve(daemonDir, "..");
  return [
    { name: "prism-spectra", path: repoRoot },
    { name: "EPK", path: path.resolve(repoRoot, "../EPK") },
    { name: "prism-focus", path: path.resolve(repoRoot, "../prism-focus") },
    { name: "prism-beam", path: path.resolve(repoRoot, "../prism-beam") },
  ];
}

async function git(repoPath: string, args: string[]): Promise<GitCommandResult> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    maxBuffer: MAX_BUFFER,
    timeout: GIT_TIMEOUT_MS,
  });
  return { stdout: String(stdout) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseDirtyFiles(status: string): { dirtyCount: number; dirtyFiles: string[] } {
  const files = status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim())
    .filter((file) => file.length > 0);
  return {
    dirtyCount: files.length,
    dirtyFiles: files.slice(0, MAX_DIRTY_FILES),
  };
}

function parseAheadBehind(value: string): { ahead: number | null; behind: number | null } {
  const [behindRaw, aheadRaw] = value.trim().split(/\s+/);
  const behind = Number(behindRaw);
  const ahead = Number(aheadRaw);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

async function readRepoStatus(repo: FixedRepo): Promise<ReadOnlyGitRepoStatus> {
  const status: ReadOnlyGitRepoStatus = {
    name: repo.name,
    path: repo.path,
    branch: null,
    dirtyCount: null,
    dirtyFiles: [],
    ahead: null,
    behind: null,
    tip: null,
    recent: [],
  };
  const errors: string[] = [];

  try {
    const { stdout } = await git(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    status.branch = stdout.trim() || null;
  } catch (error) {
    errors.push(`branch: ${errorMessage(error)}`);
  }

  try {
    const { stdout } = await git(repo.path, ["status", "--porcelain"]);
    const dirty = parseDirtyFiles(stdout);
    status.dirtyCount = dirty.dirtyCount;
    status.dirtyFiles = dirty.dirtyFiles;
  } catch (error) {
    errors.push(`status: ${errorMessage(error)}`);
  }

  try {
    const { stdout } = await git(repo.path, ["rev-parse", "--short", "HEAD"]);
    status.tip = stdout.trim() || null;
  } catch (error) {
    errors.push(`tip: ${errorMessage(error)}`);
  }

  try {
    const { stdout } = await git(repo.path, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    const counts = parseAheadBehind(stdout);
    status.ahead = counts.ahead;
    status.behind = counts.behind;
  } catch {
    status.ahead = null;
    status.behind = null;
  }

  try {
    const { stdout } = await git(repo.path, ["log", "--oneline", "-n", "5"]);
    status.recent = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    errors.push(`recent: ${errorMessage(error)}`);
  }

  if (errors.length > 0) {
    status.error = errors.join("; ");
  }
  return status;
}

export async function listReadOnlyGitStatus(daemonDir: string): Promise<ReadOnlyGitRepoStatus[]> {
  return Promise.all(fixedRepos(daemonDir).map((repo) => readRepoStatus(repo)));
}
