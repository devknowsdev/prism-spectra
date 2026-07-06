import fs from "node:fs";
import path from "node:path";
import {
  createScopedDirectoryWatcher,
  WorkbenchReloadHub,
  type WorkbenchWatcher,
} from "./liveReload.js";

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

export function loadAppPreviewDirectories(
  configPath: string,
): Map<AppPreviewName, string> {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`app preview config must be a JSON object: ${configPath}`);
  }

  const directories = new Map<AppPreviewName, string>();
  for (const app of APP_PREVIEW_NAMES) {
    const configured = (parsed as Record<string, unknown>)[app];
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
  return createScopedDirectoryWatcher({
    rootDir: options.appDir,
    ignoredDirectoryNames: APP_PREVIEW_IGNORED_DIRECTORIES,
    onReload: options.onReload,
    debounceMs: options.debounceMs,
  });
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
