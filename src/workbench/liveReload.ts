import fs from "node:fs";
import path from "node:path";

export type WorkbenchReloadListener = () => void;
export const WORKBENCH_RELOAD_SSE_EVENT = "event: reload\ndata:\n\n";

export class WorkbenchReloadHub {
  private readonly listeners = new Set<WorkbenchReloadListener>();

  subscribe(listener: WorkbenchReloadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitReload(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function subscribeWorkbenchReloadSse(
  hub: WorkbenchReloadHub,
  write: (event: string) => void,
): () => void {
  return hub.subscribe(() => {
    write(WORKBENCH_RELOAD_SSE_EVENT);
  });
}

export interface WorkbenchWatcher {
  close(): void;
}

export interface CreateWorkbenchWatcherOptions {
  workbenchDir: string;
  onReload: WorkbenchReloadListener;
  debounceMs?: number;
}

function isWatchedWorkbenchPath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  return normalized === "index.html"
    || normalized.startsWith("js/")
    || normalized.startsWith("vendor-shims/");
}

export function createScopedDirectoryWatcher(options: {
  rootDir: string;
  ignoredDirectoryNames?: ReadonlySet<string>;
  shouldReload?: (relativePath: string) => boolean;
  onReload: WorkbenchReloadListener;
  debounceMs?: number;
}): WorkbenchWatcher {
  const debounceMs = options.debounceMs ?? 150;
  const ignoredDirectoryNames = options.ignoredDirectoryNames ?? new Set<string>();
  const shouldReload = options.shouldReload ?? (() => true);
  const watchers = new Map<string, fs.FSWatcher>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function isIgnored(relativePath: string): boolean {
    return relativePath
      .split(path.sep)
      .some((segment) => ignoredDirectoryNames.has(segment));
  }

  function collectWatchDirectories(): Set<string> {
    const directories = new Set<string>();
    const pending = [options.rootDir];
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
        if (entry.isDirectory() && !ignoredDirectoryNames.has(entry.name)) {
          pending.push(path.join(directory, entry.name));
        }
      }
    }
    return directories;
  }

  function syncWatchers(): void {
    if (closed) return;
    const nextDirectories = collectWatchDirectories();
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
          ? path.relative(options.rootDir, directory)
          : path.relative(options.rootDir, path.join(directory, String(filename)));
        if (isIgnored(relativePath) || !shouldReload(relativePath)) return;
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
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

export function createWorkbenchWatcher(options: CreateWorkbenchWatcherOptions): WorkbenchWatcher {
  return createScopedDirectoryWatcher({
    rootDir: options.workbenchDir,
    shouldReload: isWatchedWorkbenchPath,
    onReload: options.onReload,
    debounceMs: options.debounceMs,
  });
}
