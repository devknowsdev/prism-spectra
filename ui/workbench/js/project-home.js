import { getJson } from "./api-client.js";

const widgetState = new Map();
let initialized = false;
let navigateToView = null;

const widgets = [
  {
    id: "current-phase",
    title: "Current phase",
    targetView: "roadmap",
    targetLabel: "Open Roadmap",
    loader: loadRoadmapWidget,
    render: renderCurrentPhase,
  },
  {
    id: "decisions-needed",
    title: "Decisions needed",
    targetView: "approvals",
    targetLabel: "Open Approvals",
    loader: loadApprovalsWidget,
    render: renderDecisionsNeeded,
  },
  {
    id: "ai-availability",
    title: "AI availability",
    targetView: "ai",
    targetLabel: "Open AI",
    loader: loadAiAvailabilityWidget,
    render: renderAiAvailability,
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateObject(payload, key) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, message: "Expected an object payload." };
  }
  if (key && (!payload[key] || typeof payload[key] !== "object")) {
    return { ok: false, message: `Expected a ${key} object.` };
  }
  return { ok: true, data: key ? payload[key] : payload };
}

function validateRoadmap(payload) {
  const base = validateObject(payload);
  if (!base.ok) return base;
  const rungs = payload.rungs;
  if (rungs != null && !Array.isArray(rungs)) {
    return { ok: false, message: "Expected roadmap.rungs to be an array." };
  }
  return { ok: true, data: payload };
}

function validateApprovals(payload) {
  const base = validateObject(payload, "approvals");
  if (!base.ok) return base;
  if (!Array.isArray(base.data.items)) {
    return { ok: false, message: "Expected approvals.items to be an array." };
  }
  return { ok: true, data: base.data };
}

function validateAiStatus(payload) {
  const base = validateObject(payload);
  if (!base.ok) return base;
  if (!Array.isArray(payload.providers)) {
    return { ok: false, message: "Expected providers to be an array." };
  }
  return { ok: true, data: payload };
}

function loadRoadmapWidget() {
  return getJson("/api/v1/roadmap", validateRoadmap);
}

function loadApprovalsWidget() {
  return getJson("/api/v1/workbench/approvals", validateApprovals);
}

function loadAiAvailabilityWidget() {
  return getJson("/api/v1/ai/status", validateAiStatus);
}

function widgetElements(id) {
  const root = document.querySelector(`[data-project-home-widget="${CSS.escape(id)}"]`);
  if (!(root instanceof HTMLElement)) return null;
  const status = root.querySelector("[data-project-home-widget-status]");
  const body = root.querySelector("[data-project-home-widget-body]");
  if (!(status instanceof HTMLElement) || !(body instanceof HTMLElement)) return null;
  return { root, status, body };
}

function actionButton(widget) {
  return `
    <button type="button" class="project-home-widget-action" data-project-home-detail="${escapeHtml(widget.targetView)}">
      ${escapeHtml(widget.targetLabel)}
    </button>
  `;
}

function renderLoading(widget) {
  const elements = widgetElements(widget.id);
  if (!elements) return;
  elements.root.dataset.widgetState = "loading";
  elements.status.textContent = "Loading...";
  elements.body.innerHTML = `<div class="empty">Loading ${escapeHtml(widget.title.toLowerCase())}...</div>`;
}

function renderUnavailable(widget, result) {
  const elements = widgetElements(widget.id);
  if (!elements) return;
  const messages = {
    unavailable: "This source is unavailable right now.",
    authentication_failure: "The local token was not accepted.",
    validation_failure: "The daemon returned data this widget could not understand.",
    transient_failure: "The source had a temporary failure.",
    error: "This widget could not load.",
  };
  const message = messages[result.type] || messages.error;
  elements.root.dataset.widgetState = result.type || "error";
  elements.status.textContent = result.type === "unavailable" ? "Unavailable" : "Degraded";
  elements.body.innerHTML = `
    <div>${escapeHtml(message)}</div>
    <div class="empty">${escapeHtml(result.message || "No extra detail was provided.")}</div>
    ${actionButton(widget)}
  `;
}

function renderWidget(widget, state, statusText, html) {
  const elements = widgetElements(widget.id);
  if (!elements) return;
  elements.root.dataset.widgetState = state;
  elements.status.textContent = statusText;
  elements.body.innerHTML = html;
}

function currentRoadmapRung(roadmap) {
  const rungs = Array.isArray(roadmap?.rungs) ? roadmap.rungs : [];
  return rungs.find((rung) => rung?.status === "current") || rungs.find((rung) => rung?.status === "next") || null;
}

function renderCurrentPhase(widget, roadmap) {
  const rung = currentRoadmapRung(roadmap);
  const phase = typeof roadmap?.phase === "string" && roadmap.phase.trim() ? roadmap.phase.trim() : "";
  const updated = typeof roadmap?.updated === "string" && roadmap.updated.trim() ? roadmap.updated.trim() : "unknown";

  if (!rung && !phase) {
    renderWidget(widget, "empty", "No phase yet", `
      <div>No roadmap phase is available yet.</div>
      ${actionButton(widget)}
    `);
    return;
  }

  const rungLabel = rung
    ? `${typeof rung.id === "string" ? `${rung.id}: ` : ""}${rung.title || "Untitled rung"}`
    : phase;
  const status = rung?.status || "phase";
  const note = rung?.note || "Roadmap data loaded successfully.";
  renderWidget(widget, "success", "Ready", `
    <strong>${escapeHtml(rungLabel)}</strong>
    <div>Phase: ${escapeHtml(phase || "not named")} · status: ${escapeHtml(status)} · updated ${escapeHtml(updated)}</div>
    <div>${escapeHtml(note)}</div>
    ${actionButton(widget)}
  `);
}

function approvalCount(approvals) {
  if (Number.isFinite(approvals?.pendingCount)) return Number(approvals.pendingCount);
  if (Number.isFinite(approvals?.count)) return Number(approvals.count);
  const items = Array.isArray(approvals?.items) ? approvals.items : [];
  return items.filter((item) => item?.status === "pending").length;
}

function renderDecisionsNeeded(widget, approvals) {
  const pending = approvalCount(approvals);
  if (pending === 0) {
    renderWidget(widget, "empty", "No pending decisions", `
      <strong>0 pending</strong>
      <div>${escapeHtml(approvals?.emptyStateMessage || "Nothing needs a decision right now.")}</div>
      ${actionButton(widget)}
    `);
    return;
  }

  renderWidget(widget, "success", "Needs attention", `
    <strong>${escapeHtml(String(pending))} pending</strong>
    <div>${pending === 1 ? "One approval is waiting for a deliberate decision." : `${pending} approvals are waiting for deliberate decisions.`}</div>
    <div>No approvals can be resolved from this widget.</div>
    ${actionButton(widget)}
  `);
}

function renderAiAvailability(widget, payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const localProviders = providers.filter((provider) => provider?.kind === "local");
  const availableLocal = localProviders.find((provider) => provider?.available === true);
  const unavailableLocal = localProviders.find((provider) => provider?.available === false);

  if (localProviders.length === 0) {
    renderWidget(widget, "empty", "No local provider", `
      <strong>Unknown</strong>
      <div>No local AI provider status was returned.</div>
      ${actionButton(widget)}
    `);
    return;
  }

  if (availableLocal) {
    renderWidget(widget, "success", "Available", `
      <strong>Local AI available</strong>
      <div>${escapeHtml(availableLocal.id || "local provider")} is available for local work.</div>
      ${actionButton(widget)}
    `);
    return;
  }

  const reason = unavailableLocal?.reason || "The local provider is not reachable.";
  renderWidget(widget, "unavailable", "Unavailable", `
    <strong>Local AI unavailable</strong>
    <div>${escapeHtml(reason)}</div>
    <div>Some AI actions may be degraded until the local provider is available again.</div>
    ${actionButton(widget)}
  `);
}

async function loadWidget(widget) {
  renderLoading(widget);
  try {
    const result = await widget.loader();
    widgetState.set(widget.id, result);
    if (!result.ok) {
      renderUnavailable(widget, result);
      return;
    }
    widget.render(widget, result.data);
  } catch (error) {
    const result = {
      ok: false,
      type: "error",
      endpoint: "project-home",
      message: error instanceof Error ? error.message : String(error),
      httpStatus: 0,
    };
    widgetState.set(widget.id, result);
    renderUnavailable(widget, result);
  }
}

function wireDetailNavigation() {
  const container = document.getElementById("project-home-widgets");
  container?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-project-home-detail]") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const targetView = button.getAttribute("data-project-home-detail") || "";
    if (typeof navigateToView === "function") {
      navigateToView(targetView);
    }
  });
}

export function initProjectHome(options = {}) {
  navigateToView = typeof options.navigate === "function" ? options.navigate : globalThis.__spectraWorkbenchNavigate;
  if (initialized) return;
  initialized = true;
  wireDetailNavigation();
  widgets.forEach((widget) => {
    widgetState.set(widget.id, { ok: false, type: "loading" });
    void loadWidget(widget);
  });
}
