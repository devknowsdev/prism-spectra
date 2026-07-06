const endpoint = "/api/v1/workbench/live";

async function connectLiveReload() {
  if (!("EventSource" in globalThis)) return;

  try {
    const probe = await fetch(endpoint, { method: "HEAD", cache: "no-store" });
    if (!probe.ok) return;

    const events = new EventSource(endpoint);
    events.addEventListener("reload", () => {
      location.reload();
    });
    events.addEventListener("error", () => {
      events.close();
    });
  } catch {
    // Live reload is optional and deliberately silent when unavailable.
  }
}

void connectLiveReload();
