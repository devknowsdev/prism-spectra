import fs from "node:fs";
import path from "node:path";
import type { WorkbenchChangePipelineConfig } from "./changePipeline.js";
import { WorkbenchReloadHub, type WorkbenchWatcher } from "./liveReload.js";

export const APP_PREVIEW_NAMES = ["focus", "epk"] as const;
export type AppPreviewName = (typeof APP_PREVIEW_NAMES)[number];

export const APP_PREVIEW_LIVERELOAD_TAG =
  '<script src="/preview/js/livereload.js"></script>';
export const APP_PREVIEW_IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "build",
  "dist",
]);

export interface AppPreview {
  app: AppPreviewName;
  directory: string;
  reloadHub: WorkbenchReloadHub;
  watcher: WorkbenchWatcher;
}

function readPreviewConfigObject(configPath: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`app preview config must be a JSON object: ${configPath}`);
  }
  return parsed as Record<string, unknown>;
}

export function loadAppPreviewDirectories(
  configPath: string,
): Map<AppPreviewName, string> {
  const parsed = readPreviewConfigObject(configPath);
  if (parsed == null) return new Map();

  const directories = new Map<AppPreviewName, string>();
  for (const app of APP_PREVIEW_NAMES) {
    const configured = parsed[app];
    if (configured == null || configured === "") continue;
    if (typeof configured !== "string") {
      throw new Error(`app preview config "${app}" must be a directory path`);
    }

    const directory = path.resolve(path.dirname(configPath), configured);
    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) {
      throw new Error(`app preview config "${app}" is not a directory: ${directory}`);
    }
    directories.set(app, fs.realpathSync(directory));
  }

  return directories;
}

export function loadWorkbenchChangePipelineConfig(
  configPath: string,
): WorkbenchChangePipelineConfig {
  const parsed = readPreviewConfigObject(configPath);
  if (parsed == null) return { reloadOnValidationFailure: false };

  const configured = parsed.workbench;
  if (configured == null || configured === "") {
    return { reloadOnValidationFailure: false };
  }
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
    throw new Error('app preview config "workbench" must be an object');
  }

  const workbench = configured as Record<string, unknown>;
  const validate = workbench.validate;
  if (validate != null && validate !== "" && typeof validate !== "string") {
    throw new Error('app preview config "workbench.validate" must be a command string');
  }
  const reloadOnValidationFailure = workbench.reloadOnValidationFailure;
  if (reloadOnValidationFailure != null && typeof reloadOnValidationFailure !== "boolean") {
    throw new Error('app preview config "workbench.reloadOnValidationFailure" must be a boolean');
  }

  return {
    validate: typeof validate === "string" && validate.trim() ? validate.trim() : undefined,
    reloadOnValidationFailure: reloadOnValidationFailure === true,
  };
}

export function injectAppPreviewLiveReload(html: string): string {
  if (html.includes(APP_PREVIEW_LIVERELOAD_TAG)) return html;
  const closingBody = /<\/body\s*>/i;
  if (closingBody.test(html)) {
    return html.replace(closingBody, `${APP_PREVIEW_LIVERELOAD_TAG}\n</body>`);
  }
  return `${html}\n${APP_PREVIEW_LIVERELOAD_TAG}\n`;
}

export function createAppPreviewWatcher(options: {
  appDir: string;
  onReload: () => void;
  debounceMs?: number;
}): WorkbenchWatcher {
  const debounceMs = options.debounceMs ?? 150;
  const watchers = new Map<string, fs.FSWatcher>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function collectDirectories(): Set<string> {
    const directories = new Set<string>();
    const pending = [options.appDir];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      directories.add(directory);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !APP_PREVIEW_IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(path.join(directory, entry.name));
        }
      }
    }
    return directories;
  }

  function syncWatchers(): void {
    if (closed) return;
    const nextDirectories = collectDirectories();
    for (const [directory, watcher] of watchers) {
      if (!nextDirectories.has(directory)) {
        watcher.close();
        watchers.delete(directory);
      }
    }
    for (const directory of nextDirectories) {
      if (watchers.has(directory)) continue;
      const watcher = fs.watch(directory, (_eventType, filename) => {
        const relativePath = filename == null
          ? path.relative(options.appDir, directory)
          : path.relative(options.appDir, path.join(directory, String(filename)));
        if (
          relativePath
            .split(path.sep)
            .some((segment) => APP_PREVIEW_IGNORED_DIRECTORIES.has(segment))
        ) {
          return;
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          syncWatchers();
          options.onReload();
        }, debounceMs);
      });
      watchers.set(directory, watcher);
    }
  }

  syncWatchers();
  return {
    close() {
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

export function createAppPreviews(
  directories: ReadonlyMap<AppPreviewName, string>,
): Map<AppPreviewName, AppPreview> {
  const previews = new Map<AppPreviewName, AppPreview>();
  try {
    for (const [app, directory] of directories) {
      const reloadHub = new WorkbenchReloadHub();
      previews.set(app, {
        app,
        directory,
        reloadHub,
        watcher: createAppPreviewWatcher({
          appDir: directory,
          onReload: () => reloadHub.emitReload(),
        }),
      });
    }
    return previews;
  } catch (error) {
    for (const preview of previews.values()) preview.watcher.close();
    throw error;
  }
}

export async function resolveAppPreviewFile(
  appDir: string,
  requestRelativePath: string,
): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestRelativePath);
  } catch {
    return null;
  }

  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const candidate = path.resolve(appDir, relative);
  const boundary = appDir.endsWith(path.sep) ? appDir : `${appDir}${path.sep}`;
  if (candidate !== appDir && !candidate.startsWith(boundary)) return null;

  try {
    let resolved = candidate;
    const candidateStat = await fs.promises.stat(resolved);
    if (candidateStat.isDirectory()) {
      resolved = path.join(resolved, "index.html");
    }
    const realResolved = await fs.promises.realpath(resolved);
    if (realResolved !== appDir && !realResolved.startsWith(boundary)) return null;
    const stat = await fs.promises.stat(realResolved);
    return stat.isFile() ? realResolved : null;
  } catch {
    return null;
  }
}
