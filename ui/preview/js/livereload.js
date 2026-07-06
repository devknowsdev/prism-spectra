(() => {
  const match = window.location.pathname.match(/^\/preview\/(focus|epk)(?:\/|$)/);
  if (!match) return;

  const liveUrl = `/api/v1/preview/${match[1]}/live`;
  fetch(liveUrl, { method: "HEAD", cache: "no-store" })
    .then((response) => {
      if (!response.ok) return;
      const events = new EventSource(liveUrl);
      events.addEventListener("reload", () => window.location.reload());
    })
    .catch(() => {});
})();
