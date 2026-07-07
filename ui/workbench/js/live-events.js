(function () {
  const endpoint = "/api/v1/events";
  const debounceMs = 80;
  const pendingViews = new Set();
  let timer = 0;

  function workbenchApi() {
    return globalThis.__spectraWorkbenchLive || {};
  }

  function relevantViews(type) {
    if (type === "approval.resolved") {
      return ["resume", "approvals", "changes"];
    }
    if (type.startsWith("checkpoint.")) {
      return ["resume", "changes"];
    }
    if (type.startsWith("capability.job.") || type.startsWith("job.")) {
      return ["resume", "changes"];
    }
    return [];
  }

  function schedule(views) {
    for (const view of views) pendingViews.add(view);
    if (timer) return;
    timer = globalThis.setTimeout(async () => {
      timer = 0;
      const viewsToRefresh = [...pendingViews];
      pendingViews.clear();
      const api = workbenchApi();
      await Promise.all(viewsToRefresh.map(async (view) => {
        try {
          if (view === "resume" && typeof api.loadResume === "function") await api.loadResume();
          if (view === "approvals" && typeof api.loadApprovals === "function") await api.loadApprovals();
          if (view === "changes" && typeof api.loadChanges === "function") await api.loadChanges();
        } catch {
          // Live provenance is additive. If an older daemon lacks an endpoint,
          // leave the current static snapshot in place.
        }
      }));
    }, debounceMs);
  }

  function handleMessage(message) {
    try {
      const event = JSON.parse(message.data);
      const type = typeof event?.type === "string" ? event.type : "";
      const views = relevantViews(type);
      if (views.length > 0) schedule(views);
    } catch {
      // Ignore comments, malformed messages, and future event shapes.
    }
  }

  if (!("EventSource" in globalThis)) return;

  try {
    const events = new EventSource(endpoint);
    events.addEventListener("message", handleMessage);
    events.addEventListener("error", () => {
      if (events.readyState === EventSource.CLOSED) return;
    });
  } catch {
    // No-op when the daemon does not provide the local event stream.
  }
})();
