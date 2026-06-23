import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  type AdapterAction,
  type AdapterContract,
  type AdapterContext,
  type AdapterError,
  type AdapterResult,
  type ApprovalRequirement,
  createAdapterError,
  createAdapterResult,
  nowIso,
} from "./types.js";
import { blockedAdapterResult, ensureApprovalAllowed } from "./approvalGuard.js";
import { createFilesystemPathGuard, type FilesystemPathGuard } from "./filesystemPathGuard.js";
import { PRISM_SIDECAR_SUFFIX } from "../ingest/sidecar.js";

export const FILESYSTEM_OPERATIONS = [
  "readTextFile",
  "writeTextFile",
  "listDirectory",
  "ensureDirectory",
  "statPath",
  "computeSha256",
  "writeJsonSidecar",
  "readJsonFile",
  "writeJsonFile",
] as const;

export type FilesystemOperationName = (typeof FILESYSTEM_OPERATIONS)[number];

export interface FilesystemAdapterConfig {
  allowedRoots: string[];
  baseDir?: string;
  id?: string;
  name?: string;
  sidecarSuffix?: string;
  jsonIndent?: number;
}

export interface FilesystemActionInput {
  path: string;
  content?: string;
  data?: unknown;
  json?: unknown;
  sidecarSuffix?: string;
  jsonIndent?: number;
}

export interface FilesystemDirectoryEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size?: number;
}

export interface FilesystemStatSnapshot {
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export type FilesystemOperationOutput =
  | {
      operation: "readTextFile";
      path: string;
      resolvedPath: string;
      content: string;
      bytesRead: number;
      sha256: string;
    }
  | {
      operation: "writeTextFile";
      path: string;
      resolvedPath: string;
      bytesWritten: number;
      sha256: string;
    }
  | {
      operation: "listDirectory";
      path: string;
      resolvedPath: string;
      entries: FilesystemDirectoryEntry[];
    }
  | {
      operation: "ensureDirectory";
      path: string;
      resolvedPath: string;
      created: boolean;
    }
  | {
      operation: "statPath";
      path: string;
      resolvedPath: string;
      stat: FilesystemStatSnapshot;
    }
  | {
      operation: "computeSha256";
      path: string;
      resolvedPath: string;
      bytesRead: number;
      sha256: string;
    }
  | {
      operation: "writeJsonSidecar";
      path: string;
      resolvedPath: string;
      sidecarPath: string;
      sidecarResolvedPath: string;
      bytesWritten: number;
      sha256: string;
    }
  | {
      operation: "readJsonFile";
      path: string;
      resolvedPath: string;
      data: unknown;
      bytesRead: number;
    }
  | {
      operation: "writeJsonFile";
      path: string;
      resolvedPath: string;
      bytesWritten: number;
      sha256: string;
    };

interface FilesystemAdapterDetails {
  operation: string;
  targetPath: string;
  resolvedPath?: string;
  root?: string;
  bytesRead?: number;
  bytesWritten?: number;
  sha256?: string;
  sidecarPath?: string;
  sidecarResolvedPath?: string;
  entries?: FilesystemDirectoryEntry[];
  stat?: FilesystemStatSnapshot;
}

function errorWithDetails(
  adapterId: string,
  actionId: string,
  code: string,
  message: string,
  details: Record<string, unknown>,
) {
  return createAdapterError(adapterId, actionId, code, message, details);
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toBuffer(content: string): Buffer {
  return Buffer.from(content, "utf8");
}

function formatJson(value: unknown, indent: number): string {
  return `${JSON.stringify(value, null, indent)}\n`;
}

function entryKindFromDirent(name: string, dirent: fsSync.Dirent): FilesystemDirectoryEntry {
  return {
    name,
    path: name,
    kind: dirent.isSymbolicLink() ? "symlink" : dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : "other",
  };
}

function statSnapshotFromStats(stats: fsSync.Stats): FilesystemStatSnapshot {
  return {
    kind: stats.isSymbolicLink() ? "symlink" : stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymbolicLink: stats.isSymbolicLink(),
  };
}

function serializeMetadata(details: FilesystemAdapterDetails, allowedRoots: string[], riskLevel: string, approvalRequired: ApprovalRequirement) {
  return {
    operation: details.operation,
    targetPath: details.targetPath,
    resolvedPath: details.resolvedPath,
    root: details.root,
    allowedRoots,
    riskLevel,
    approvalRequired,
    bytesRead: details.bytesRead,
    bytesWritten: details.bytesWritten,
    sha256: details.sha256,
    sidecarPath: details.sidecarPath,
    sidecarResolvedPath: details.sidecarResolvedPath,
    entries: details.entries,
    stat: details.stat,
  };
}

function buildSupportedOperationError(adapterId: string, actionId: string, operation: string, targetPath: string, allowedRoots: string[]) {
  return errorWithDetails(
    adapterId,
    actionId,
    "unsupported_operation",
    `Unsupported filesystem operation: ${operation}.`,
    { operation, targetPath, allowedRoots },
  );
}

function isFilesystemAdapterError(value: unknown): value is AdapterError {
  return !!value && typeof value === "object" && "adapterId" in value && "actionId" in value && "code" in value && "message" in value;
}

function isReadOperation(operation: string): boolean {
  return operation === "readTextFile" || operation === "listDirectory" || operation === "statPath" || operation === "computeSha256" || operation === "readJsonFile";
}

function mapFilesystemFailure(adapterId: string, actionId: string, operation: string, targetPath: string, error: unknown): AdapterError {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);

  if (code === "ENOENT") {
    return createAdapterError(adapterId, actionId, "file_not_found", message, { operation, targetPath, code });
  }

  if (code === "ENOTDIR" || code === "EISDIR") {
    return createAdapterError(adapterId, actionId, "not_a_directory", message, { operation, targetPath, code });
  }

  return createAdapterError(adapterId, actionId, isReadOperation(operation) ? "read_failed" : "write_failed", message, {
    operation,
    targetPath,
    code,
  });
}

async function readTextFileData(resolvedPath: string): Promise<{ content: string; bytesRead: number; sha256: string }> {
  const bytes = await fs.readFile(resolvedPath);
  return {
    content: bytes.toString("utf8"),
    bytesRead: bytes.byteLength,
    sha256: hashBytes(bytes),
  };
}

async function writeTextFileData(resolvedPath: string, content: string): Promise<{ bytesWritten: number; sha256: string }> {
  const bytes = toBuffer(content);
  await fs.writeFile(resolvedPath, bytes);
  return {
    bytesWritten: bytes.byteLength,
    sha256: hashBytes(bytes),
  };
}

export function createFilesystemAdapter(config: FilesystemAdapterConfig): AdapterContract<FilesystemOperationOutput> {
  if (!config.allowedRoots.length) {
    throw new Error("Filesystem adapter requires at least one allowed root.");
  }

  const adapterId = config.id ?? "filesystem";
  const adapterName = config.name ?? "Filesystem Adapter";
  const sidecarSuffix = config.sidecarSuffix ?? PRISM_SIDECAR_SUFFIX;
  const jsonIndent = config.jsonIndent ?? 2;
  const pathGuard: FilesystemPathGuard = createFilesystemPathGuard({
    adapterId,
    allowedRoots: config.allowedRoots,
    baseDir: config.baseDir,
  });
  const allowedRoots = pathGuard.allowedRoots;
  const baseDir = pathGuard.baseDir;

  const descriptor = {
    id: adapterId,
    kind: "filesystem" as const,
    mode: "real" as const,
    approvalRequired: "recommended" as const,
  };

  return {
    ...descriptor,
    name: adapterName,
    capabilities: [
      {
        id: "readTextFile",
        label: "Read text file",
        kind: "filesystem",
        description: "Read a text file inside an allowed root.",
        riskLevel: "read_only",
        approvalRequired: "none",
      },
      {
        id: "writeTextFile",
        label: "Write text file",
        kind: "filesystem",
        description: "Write a UTF-8 text file inside an allowed root.",
        riskLevel: "local_write",
        approvalRequired: "recommended",
      },
      {
        id: "listDirectory",
        label: "List directory",
        kind: "filesystem",
        description: "List a directory without following symlinks.",
        riskLevel: "read_only",
        approvalRequired: "none",
      },
      {
        id: "ensureDirectory",
        label: "Ensure directory",
        kind: "filesystem",
        description: "Create a directory path inside an allowed root.",
        riskLevel: "local_write",
        approvalRequired: "recommended",
      },
      {
        id: "statPath",
        label: "Stat path",
        kind: "filesystem",
        description: "Inspect file or directory metadata for an allowed path.",
        riskLevel: "read_only",
        approvalRequired: "none",
      },
      {
        id: "computeSha256",
        label: "Compute SHA-256",
        kind: "filesystem",
        description: "Hash a local file deterministically.",
        riskLevel: "read_only",
        approvalRequired: "none",
      },
      {
        id: "writeJsonSidecar",
        label: "Write JSON sidecar",
        kind: "filesystem",
        description: "Write deterministic .prism.json metadata next to a local file.",
        riskLevel: "local_write",
        approvalRequired: "recommended",
      },
      {
        id: "readJsonFile",
        label: "Read JSON file",
        kind: "filesystem",
        description: "Read and parse a local JSON file.",
        riskLevel: "read_only",
        approvalRequired: "none",
      },
      {
        id: "writeJsonFile",
        label: "Write JSON file",
        kind: "filesystem",
        description: "Write a deterministic JSON file inside an allowed root.",
        riskLevel: "local_write",
        approvalRequired: "recommended",
      },
    ],
    health: async () => ({
      status: "healthy",
      checkedAt: nowIso(),
      message: "Filesystem adapter ready.",
      details: { adapterId, allowedRoots, baseDir, sidecarSuffix },
    }),
    async execute(action: AdapterAction, context: AdapterContext): Promise<AdapterResult<FilesystemOperationOutput>> {
      const operation = action.operation as FilesystemOperationName | string;
      try {
        ensureApprovalAllowed(descriptor, context, action);

        const input = (action.input ?? {}) as unknown as FilesystemActionInput;
        const targetPath = input.path;
        if (!targetPath || typeof targetPath !== "string") {
          return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
            success: false,
            blocked: false,
            output: null,
            error: errorWithDetails(
              descriptor.id,
              action.id,
              "missing_path",
              "Filesystem operations require input.path.",
              { operation },
            ),
            metadata: serializeMetadata({ operation, targetPath: "", root: baseDir }, allowedRoots, action.riskLevel, action.approvalRequired ?? "recommended"),
          });
        }

        if (operation === "delete" || operation === "deletePath" || action.riskLevel === "destructive") {
          return blockedAdapterResult<FilesystemOperationOutput>(
            descriptor,
            action,
            errorWithDetails(
              descriptor.id,
              action.id,
              "unsupported_operation",
              `Destructive filesystem operations are not implemented: ${operation}.`,
              { operation, targetPath, allowedRoots },
            ),
            serializeMetadata({ operation, targetPath, root: baseDir }, allowedRoots, action.riskLevel, action.approvalRequired ?? "required"),
          );
        }

        switch (operation) {
          case "readTextFile": {
            const { resolvedPath, root } = await pathGuard.validateReadablePath(targetPath, action.id, "file");
            const data = await readTextFileData(resolvedPath);
            return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
              success: true,
              blocked: false,
              output: {
                operation,
                path: targetPath,
                resolvedPath,
                content: data.content,
                bytesRead: data.bytesRead,
                sha256: data.sha256,
              },
              metadata: serializeMetadata(
                {
                  operation,
                  targetPath,
                  resolvedPath,
                  root,
                  bytesRead: data.bytesRead,
                  sha256: data.sha256,
                },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "none",
              ),
            });
          }

          case "writeTextFile": {
            const targetAbs = pathGuard.resolveTargetPath(targetPath);
            const { root } = await pathGuard.validateWritablePath(targetPath, action.id, "file");
            const content = String(input.content ?? "");
            await fs.mkdir(path.dirname(targetAbs), { recursive: true });
            await pathGuard.validateWritablePath(targetPath, action.id, "file");
            const data = await writeTextFileData(targetAbs, content);
            const writtenRealPath = await fs.realpath(targetAbs);
            return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
              success: true,
              blocked: false,
              output: {
                operation,
                path: targetPath,
                resolvedPath: writtenRealPath,
                bytesWritten: data.bytesWritten,
                sha256: data.sha256,
              },
              metadata: serializeMetadata(
                {
                  operation,
                  targetPath,
                  resolvedPath: writtenRealPath,
                  root,
                  bytesWritten: data.bytesWritten,
                  sha256: data.sha256,
                },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "recommended",
              ),
            });
          }

          case "listDirectory": {
            const { resolvedPath, root } = await pathGuard.validateReadablePath(targetPath, action.id, "directory");
            const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
            const mapped = await Promise.all(
              entries
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(async (entry) => {
                  const childPath = path.join(resolvedPath, entry.name);
                  const childStat = entry.isSymbolicLink() ? null : await fs.stat(childPath).catch(() => null);
                  const detail = entryKindFromDirent(entry.name, entry);
                  return {
                    ...detail,
                    path: childPath,
                    size: childStat?.size,
                  } satisfies FilesystemDirectoryEntry;
                }),
            );

            return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
              success: true,
              blocked: false,
              output: {
                operation,
                path: targetPath,
                resolvedPath,
                entries: mapped,
              },
              metadata: serializeMetadata(
                {
                  operation,
                  targetPath,
                  resolvedPath,
                  root,
                  entries: mapped,
                },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "none",
              ),
            });
          }

          case "ensureDirectory": {
            const targetAbs = pathGuard.resolveTargetPath(targetPath);
            const { root } = await pathGuard.validateWritablePath(targetPath, action.id, "directory");
            const existedBefore = fsSync.existsSync(targetAbs);
            await fs.mkdir(targetAbs, { recursive: true });
            await pathGuard.validateWritablePath(targetPath, action.id, "directory");
            const madePath = await fs.realpath(targetAbs);
            return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
              success: true,
              blocked: false,
              output: {
                operation,
                path: targetPath,
                resolvedPath: madePath,
                created: !existedBefore,
              },
              metadata: serializeMetadata(
                {
                  operation,
                  targetPath,
                  resolvedPath: madePath,
                  root,
                },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "recommended",
              ),
            });
          }

          case "statPath": {
            const { resolvedPath, root } = await pathGuard.validateReadablePath(targetPath, action.id, "any");
            const stats = await fs.stat(resolvedPath);
            const snapshot = statSnapshotFromStats(stats);
            return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
              success: true,
              blocked: false,
              output: {
                operation,
                path: targetPath,
                resolvedPath,
                stat: snapshot,
              },
              metadata: serializeMetadata(
                {
                  operation,
                  targetPath,
                  resolvedPath,
                  root,
                  stat: snapshot,
                },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "none",
              ),
            });
          }

          case "computeSha256": {
            const { resolvedPath, root } = await pathGuard.validateReadablePath(targetPath, action.id, "file");
            const bytes = await fs.readFile(resolvedPath);
            const sha256 = hashBytes(bytes);
            return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
              success: true,
              blocked: false,
              output: {
                operation,
                path: targetPath,
                resolvedPath,
                bytesRead: bytes.byteLength,
                sha256,
              },
              metadata: serializeMetadata(
                {
                  operation,
                  targetPath,
                  resolvedPath,
                  root,
                  bytesRead: bytes.byteLength,
                  sha256,
                },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "none",
              ),
            });
          }

          case "writeJsonSidecar": {
            const { root } = await pathGuard.validateWritablePath(targetPath, action.id, "file");
            const { resolvedPath: targetResolvedPath } = await pathGuard.validateReadablePath(targetPath, action.id, "file");
            const sidecarRelativePath = `${targetPath}${input.sidecarSuffix ?? sidecarSuffix}`;
            const sidecarTarget = pathGuard.resolveTargetPath(sidecarRelativePath);
            await pathGuard.validateWritablePath(sidecarRelativePath, action.id, "file");
            const jsonValue = input.data ?? input.json ?? {};
            const jsonText = formatJson(jsonValue, input.jsonIndent ?? jsonIndent);
            const bytes = toBuffer(jsonText);
            await fs.mkdir(path.dirname(sidecarTarget), { recursive: true });
            await pathGuard.validateWritablePath(sidecarRelativePath, action.id, "file");
            await fs.writeFile(sidecarTarget, bytes);
            const realSidecar = await fs.realpath(sidecarTarget);
            return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
              success: true,
              blocked: false,
              output: {
                operation,
                path: targetPath,
                resolvedPath: targetResolvedPath,
                sidecarPath: sidecarTarget,
                sidecarResolvedPath: realSidecar,
                bytesWritten: bytes.byteLength,
                sha256: hashBytes(bytes),
              },
              metadata: serializeMetadata(
                {
                  operation,
                  targetPath,
                  resolvedPath: targetResolvedPath,
                  root,
                  sidecarPath: sidecarTarget,
                  sidecarResolvedPath: realSidecar,
                  bytesWritten: bytes.byteLength,
                  sha256: hashBytes(bytes),
                },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "recommended",
              ),
            });
          }

          case "readJsonFile": {
            const { resolvedPath, root } = await pathGuard.validateReadablePath(targetPath, action.id, "file");
            const bytes = await fs.readFile(resolvedPath);
            const text = bytes.toString("utf8");
            let data: unknown;
            try {
              data = JSON.parse(text);
            } catch (error) {
              return blockedAdapterResult<FilesystemOperationOutput>(
                descriptor,
                action,
                errorWithDetails(
                  descriptor.id,
                  action.id,
                  "invalid_json",
                  `Failed to parse JSON from ${resolvedPath}.`,
                  { targetPath, resolvedPath, error: error instanceof Error ? error.message : String(error) },
                ),
                serializeMetadata(
                  {
                    operation,
                    targetPath,
                    resolvedPath,
                    root,
                    bytesRead: bytes.byteLength,
                  },
                  allowedRoots,
                  action.riskLevel,
                  action.approvalRequired ?? "none",
                ),
              );
            }
            return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
              success: true,
              blocked: false,
              output: {
                operation,
                path: targetPath,
                resolvedPath,
                data,
                bytesRead: bytes.byteLength,
              },
              metadata: serializeMetadata(
                {
                  operation,
                  targetPath,
                  resolvedPath,
                  root,
                  bytesRead: bytes.byteLength,
                },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "none",
              ),
            });
          }

          case "writeJsonFile": {
            const targetAbs = pathGuard.resolveTargetPath(targetPath);
            const { root } = await pathGuard.validateWritablePath(targetPath, action.id, "file");
            const jsonText = formatJson(input.data ?? input.json ?? {}, input.jsonIndent ?? jsonIndent);
            const bytes = toBuffer(jsonText);
            await fs.mkdir(path.dirname(targetAbs), { recursive: true });
            await pathGuard.validateWritablePath(targetPath, action.id, "file");
            await fs.writeFile(targetAbs, bytes);
            const realPath = await fs.realpath(targetAbs);
            return createAdapterResult<FilesystemOperationOutput>(descriptor, action, {
              success: true,
              blocked: false,
              output: {
                operation,
                path: targetPath,
                resolvedPath: realPath,
                bytesWritten: bytes.byteLength,
                sha256: hashBytes(bytes),
              },
              metadata: serializeMetadata(
                {
                  operation,
                  targetPath,
                  resolvedPath: realPath,
                  root,
                  bytesWritten: bytes.byteLength,
                  sha256: hashBytes(bytes),
                },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "recommended",
              ),
            });
          }

          default:
            return blockedAdapterResult<FilesystemOperationOutput>(
              descriptor,
              action,
              buildSupportedOperationError(descriptor.id, action.id, operation, targetPath, allowedRoots),
              serializeMetadata(
                { operation, targetPath, root: baseDir },
                allowedRoots,
                action.riskLevel,
                action.approvalRequired ?? "recommended",
              ),
            );
        }
      } catch (error) {
        if (isFilesystemAdapterError(error)) {
          const adapterError = error;
          return blockedAdapterResult<FilesystemOperationOutput>(
            descriptor,
            action,
            adapterError,
            serializeMetadata(
              {
                operation,
                targetPath: typeof action.input?.path === "string" ? action.input.path : "",
                root: baseDir,
              },
              allowedRoots,
              action.riskLevel,
              action.approvalRequired ?? "recommended",
            ),
          );
        }

        if (error instanceof Error && "adapterError" in error && (error as any).adapterError) {
          const adapterError = (error as any).adapterError as AdapterError;
          return blockedAdapterResult<FilesystemOperationOutput>(
            descriptor,
            action,
            adapterError,
            serializeMetadata(
              {
                operation,
                targetPath: typeof action.input?.path === "string" ? action.input.path : "",
                root: baseDir,
              },
              allowedRoots,
              action.riskLevel,
              action.approvalRequired ?? "recommended",
            ),
          );
        }

        return blockedAdapterResult<FilesystemOperationOutput>(
          descriptor,
          action,
          mapFilesystemFailure(descriptor.id, action.id, operation, typeof action.input?.path === "string" ? action.input.path : "", error),
          serializeMetadata(
            {
              operation,
              targetPath: typeof action.input?.path === "string" ? action.input.path : "",
              root: baseDir,
            },
            allowedRoots,
            action.riskLevel,
            action.approvalRequired ?? "recommended",
          ),
        );
      }
    },
  };
}
