import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createAdapterError, type AdapterError } from "./types.js";

export interface FilesystemPathGuardConfig {
  adapterId: string;
  allowedRoots: string[];
  baseDir?: string;
}

export interface FilesystemReadablePath {
  targetPath: string;
  resolvedPath: string;
  root: string;
}

export interface FilesystemWritablePath {
  targetPath: string;
  root: string;
  parentPath: string;
  parentResolvedPath: string;
}

export interface FilesystemPathGuard {
  allowedRoots: string[];
  baseDir: string;
  resolveTargetPath: (inputPath: string) => string;
  validateReadablePath: (inputPath: string, actionId: string, expectedKind?: "file" | "directory" | "any") => Promise<FilesystemReadablePath>;
  validateWritablePath: (inputPath: string, actionId: string, expectedKind?: "file" | "directory") => Promise<FilesystemWritablePath>;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function hasTraversalSegments(inputPath: string): boolean {
  return inputPath.split(/[\\/]+/).some((segment) => segment === "..");
}

function pathError(adapterId: string, actionId: string, code: string, message: string, details: Record<string, unknown>): AdapterError {
  return createAdapterError(adapterId, actionId, code, message, details);
}

async function realpathIfExists(candidate: string): Promise<string | null> {
  try {
    return await fs.realpath(candidate);
  } catch {
    return null;
  }
}

async function nearestExistingAncestor(candidate: string): Promise<string | null> {
  let current = candidate;
  for (;;) {
    if (fsSync.existsSync(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function resolveTargetPath(baseDir: string, inputPath: string): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(baseDir, inputPath);
}

function resolvedRootForPath(targetPath: string, allowedRoots: string[]): string | null {
  return allowedRoots.find((allowedRoot) => isInsideRoot(allowedRoot, targetPath)) ?? null;
}

async function assertKind(
  resolvedPath: string,
  expectedKind: "file" | "directory" | "any",
  adapterId: string,
  actionId: string,
  targetPath: string,
  details: Record<string, unknown>,
): Promise<void> {
  if (expectedKind === "any") {
    return;
  }

  const stats = await fs.stat(resolvedPath);
  if (expectedKind === "directory" && !stats.isDirectory()) {
    throw pathError(adapterId, actionId, "not_a_directory", `Path ${targetPath} is not a directory.`, details);
  }
  if (expectedKind === "file" && stats.isDirectory()) {
    throw pathError(adapterId, actionId, "not_a_directory", `Path ${targetPath} is not a file.`, details);
  }
}

export function createFilesystemPathGuard(config: FilesystemPathGuardConfig): FilesystemPathGuard {
  if (!config.allowedRoots.length) {
    throw new Error("Filesystem path guard requires at least one allowed root.");
  }

  const allowedRoots = config.allowedRoots.map((root) => fsSync.realpathSync(path.resolve(root)));
  const baseDir = fsSync.realpathSync(path.resolve(config.baseDir ?? allowedRoots[0]));

  if (!allowedRoots.some((root) => isInsideRoot(root, baseDir))) {
    throw new Error(`Filesystem adapter baseDir ${baseDir} must be inside one of the allowed roots.`);
  }

  function validateTraversal(inputPath: string, adapterId: string, actionId: string): void {
    if (hasTraversalSegments(inputPath)) {
      throw pathError(
        adapterId,
        actionId,
        "path_traversal_blocked",
        `Path traversal is blocked for ${inputPath}.`,
        { inputPath, allowedRoots },
      );
    }
  }

  async function validateReadablePath(
    inputPath: string,
    actionId: string,
    expectedKind: "file" | "directory" | "any" = "file",
  ): Promise<FilesystemReadablePath> {
    validateTraversal(inputPath, config.adapterId, actionId);

    const targetPath = resolveTargetPath(baseDir, inputPath);
    const root = resolvedRootForPath(targetPath, allowedRoots);
    if (!root) {
      throw pathError(
        config.adapterId,
        actionId,
        "path_outside_allowed_roots",
        `Path ${targetPath} is outside the allowed roots.`,
        { inputPath, targetPath, allowedRoots, kind: "read" },
      );
    }

    const realPath = await realpathIfExists(targetPath);
    if (!realPath) {
      throw pathError(
        config.adapterId,
        actionId,
        "file_not_found",
        `Path ${targetPath} does not exist.`,
        { inputPath, targetPath, allowedRoots, kind: "read" },
      );
    }

    if (realPath !== targetPath) {
      throw pathError(
        config.adapterId,
        actionId,
        "symlink_rejected",
        `Symlinks are rejected for ${targetPath}.`,
        { inputPath, targetPath, resolvedPath: realPath, allowedRoots, kind: "read" },
      );
    }

    if (!resolvedRootForPath(realPath, allowedRoots)) {
      throw pathError(
        config.adapterId,
        actionId,
        "path_outside_allowed_roots",
        `Path ${targetPath} resolves outside the allowed roots.`,
        { inputPath, targetPath, resolvedPath: realPath, allowedRoots, kind: "read" },
      );
    }

    await assertKind(realPath, expectedKind, config.adapterId, actionId, targetPath, {
      inputPath,
      targetPath,
      resolvedPath: realPath,
      allowedRoots,
      kind: "read",
    });

    return { targetPath, resolvedPath: realPath, root };
  }

  async function validateWritablePath(
    inputPath: string,
    actionId: string,
    expectedKind: "file" | "directory" = "file",
  ): Promise<FilesystemWritablePath> {
    validateTraversal(inputPath, config.adapterId, actionId);

    const targetPath = resolveTargetPath(baseDir, inputPath);
    const root = resolvedRootForPath(targetPath, allowedRoots);
    if (!root) {
      throw pathError(
        config.adapterId,
        actionId,
        "path_outside_allowed_roots",
        `Path ${targetPath} is outside the allowed roots.`,
        { inputPath, targetPath, allowedRoots, kind: "write" },
      );
    }

    const targetRealPath = await realpathIfExists(targetPath);
    if (targetRealPath) {
      if (targetRealPath !== targetPath) {
        throw pathError(
          config.adapterId,
          actionId,
          "symlink_rejected",
          `Symlinks are rejected for ${targetPath}.`,
          { inputPath, targetPath, resolvedPath: targetRealPath, allowedRoots, kind: "write" },
        );
      }

      await assertKind(targetRealPath, expectedKind, config.adapterId, actionId, targetPath, {
        inputPath,
        targetPath,
        resolvedPath: targetRealPath,
        allowedRoots,
        kind: "write",
      });
    }

    const parentPath = path.dirname(targetPath);
    const existingAncestor = await nearestExistingAncestor(parentPath);
    if (!existingAncestor) {
      throw pathError(
        config.adapterId,
        actionId,
        "file_not_found",
        `Path ${parentPath} does not exist.`,
        { inputPath, targetPath, allowedRoots, kind: "write" },
      );
    }

    const parentResolvedPath = await realpathIfExists(existingAncestor);
    if (!parentResolvedPath) {
      throw pathError(
        config.adapterId,
        actionId,
        "file_not_found",
        `Path ${parentPath} does not exist.`,
        { inputPath, targetPath, allowedRoots, kind: "write" },
      );
    }

    if (parentResolvedPath !== existingAncestor) {
      throw pathError(
        config.adapterId,
        actionId,
        "symlink_rejected",
        `Symlinks are rejected for ${parentPath}.`,
        { inputPath, targetPath, parentPath, resolvedPath: parentResolvedPath, allowedRoots, kind: "write" },
      );
    }

    if (!resolvedRootForPath(parentResolvedPath, allowedRoots)) {
      throw pathError(
        config.adapterId,
        actionId,
        "path_outside_allowed_roots",
        `Path ${parentPath} resolves outside the allowed roots.`,
        { inputPath, targetPath, parentPath, resolvedPath: parentResolvedPath, allowedRoots, kind: "write" },
      );
    }

    const parentStats = await fs.stat(parentResolvedPath);
    if (!parentStats.isDirectory()) {
      throw pathError(
        config.adapterId,
        actionId,
        "not_a_directory",
        `Path ${parentPath} is not a directory.`,
        { inputPath, targetPath, parentPath, resolvedPath: parentResolvedPath, allowedRoots, kind: "write" },
      );
    }

    return { targetPath, root, parentPath, parentResolvedPath };
  }

  return {
    allowedRoots,
    baseDir,
    resolveTargetPath: (inputPath: string) => resolveTargetPath(baseDir, inputPath),
    validateReadablePath,
    validateWritablePath,
  };
}
