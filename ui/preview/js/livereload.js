(() => {
  const liveUrl = "/api/v1/preview/live";
  fetch(liveUrl, { method: "HEAD", cache: "no-store" })
    .then((response) => {
      if (!response.ok) return;
      const events = new EventSource(liveUrl);
      events.addEventListener("reload", () => window.location.reload());
    })
    .catch(() => {});
})();
