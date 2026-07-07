import fs from "node:fs";
import path from "node:path";
import type { PrismEventLedger } from "../events/ledger.js";
import type { ValidationOutcome } from "../safety/validation.js";
import {
  handleWorkbenchChangePipeline,
  type WorkbenchChangePipelineConfig,
} from "./changePipeline.js";
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

// Parse the `validate` / `reloadOnValidationFailure` pipeline fields shared by
// the workbench and per-app (focus/epk) config objects. `label` names the
// config section in error messages (e.g. "workbench", "focus").
function parsePipelineFields(
  section: Record<string, unknown>,
  label: string,
): WorkbenchChangePipelineConfig {
  const validate = section.validate;
  if (validate != null && validate !== "" && typeof validate !== "string") {
    throw new Error(`app preview config "${label}.validate" must be a command string`);
  }
  const reloadOnValidationFailure = section.reloadOnValidationFailure;
  if (reloadOnValidationFailure != null && typeof reloadOnValidationFailure !== "boolean") {
    throw new Error(`app preview config "${label}.reloadOnValidationFailure" must be a boolean`);
  }

  return {
    validate: typeof validate === "string" && validate.trim() ? validate.trim() : undefined,
    reloadOnValidationFailure: reloadOnValidationFailure === true,
  };
}

interface AppPreviewEntry {
  directory: string;
  pipeline: WorkbenchChangePipelineConfig;
}

// Resolve a single focus/epk entry, which may be either a bare directory-path
// string (legacy #38/#40 form) or an object `{ dir, validate?,
// reloadOnValidationFailure? }`. The object form co-locates the per-app
// validation command with its directory, mirroring the workbench section.
function readAppPreviewEntry(
  parsed: Record<string, unknown>,
  app: AppPreviewName,
  configPath: string,
): AppPreviewEntry | null {
  const configured = parsed[app];
  if (configured == null || configured === "") return null;

  let dirValue: unknown;
  let pipeline: WorkbenchChangePipelineConfig = { reloadOnValidationFailure: false };

  if (typeof configured === "string") {
    dirValue = configured;
  } else if (typeof configured === "object" && !Array.isArray(configured)) {
    const section = configured as Record<string, unknown>;
    dirValue = section.dir;
    pipeline = parsePipelineFields(section, app);
  } else {
    throw new Error(`app preview config "${app}" must be a directory path or an object`);
  }

  if (typeof dirValue !== "string" || dirValue === "") {
    throw new Error(`app preview config "${app}" must include a directory path`);
  }

  const directory = path.resolve(path.dirname(configPath), dirValue);
  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) {
    throw new Error(`app preview config "${app}" is not a directory: ${directory}`);
  }
  return { directory: fs.realpathSync(directory), pipeline };
}

export function loadAppPreviewDirectories(
  configPath: string,
): Map<AppPreviewName, string> {
  const parsed = readPreviewConfigObject(configPath);
  if (parsed == null) return new Map();

  const directories = new Map<AppPreviewName, string>();
  for (const app of APP_PREVIEW_NAMES) {
    const entry = readAppPreviewEntry(parsed, app, configPath);
    if (entry) directories.set(app, entry.directory);
  }

  return directories;
}

export function loadAppPreviewChangePipelineConfigs(
  configPath: string,
): Map<AppPreviewName, WorkbenchChangePipelineConfig> {
  const parsed = readPreviewConfigObject(configPath);
  const configs = new Map<AppPreviewName, WorkbenchChangePipelineConfig>();
  if (parsed == null) return configs;

  for (const app of APP_PREVIEW_NAMES) {
    const entry = readAppPreviewEntry(parsed, app, configPath);
    if (entry) configs.set(app, entry.pipeline);
  }

  return configs;
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

  return parsePipelineFields(configured as Record<string, unknown>, "workbench");
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

export interface CreateAppPreviewsOptions {
  /** Ledger used to record pipeline.* provenance for validated app changes. */
  eventLedger?: PrismEventLedger;
  /** Per-app validation config (from the local git-ignored preview config). */
  pipelineConfigs?: ReadonlyMap<AppPreviewName, WorkbenchChangePipelineConfig>;
  /** Test seam: override the shell runner used by the change pipeline. */
  runsCleanFn?: (command: string, cwd: string) => Promise<ValidationOutcome>;
}

export function createAppPreviews(
  directories: ReadonlyMap<AppPreviewName, string>,
  options: CreateAppPreviewsOptions = {},
): Map<AppPreviewName, AppPreview> {
  const previews = new Map<AppPreviewName, AppPreview>();
  try {
    for (const [app, directory] of directories) {
      const reloadHub = new WorkbenchReloadHub();
      const pipelineConfig = options.pipelineConfigs?.get(app);
      const eventLedger = options.eventLedger;
      previews.set(app, {
        app,
        directory,
        reloadHub,
        watcher: createAppPreviewWatcher({
          appDir: directory,
          onReload: () => {
            // No configured command (or no ledger to record into) → byte-for-byte
            // the pre-pipeline behaviour: a direct reload with zero pipeline.*
            // events. Identical to how #43 treats an unconfigured Workbench.
            if (!eventLedger || !pipelineConfig?.validate?.trim()) {
              reloadHub.emitReload();
              return;
            }
            void handleWorkbenchChangePipeline({
              target: app,
              config: pipelineConfig,
              eventLedger,
              emitReload: () => reloadHub.emitReload(),
              workDir: directory,
              runsCleanFn: options.runsCleanFn,
            }).catch((error) => {
              console.warn(`[app-preview] ${app} change pipeline failed:`, error);
            });
          },
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
