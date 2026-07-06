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

function isWatchedWorkbenchPath(filename: string | Buffer | null): boolean {
  if (filename == null) return false;
  const relativePath = String(filename).split(path.sep).join("/");
  return relativePath === "index.html"
    || relativePath.startsWith("js/")
    || relativePath.startsWith("vendor-shims/");
}

export function createWorkbenchWatcher(options: CreateWorkbenchWatcherOptions): WorkbenchWatcher {
  const debounceMs = options.debounceMs ?? 150;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const watcher = fs.watch(options.workbenchDir, { recursive: true }, (_eventType, filename) => {
    if (!isWatchedWorkbenchPath(filename)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      options.onReload();
    }, debounceMs);
  });

  return {
    close() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      watcher.close();
    },
  };
}
