import "./conversations.js";

const statusElement = document.getElementById("approvals-status");
const emptyElement = document.getElementById("approvals-empty");
const listElement = document.getElementById("approvals-list");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function riskTier(approvalClass) {
  if (approvalClass === "destructive") return "red";
  if (["write", "remote", "expensive"].includes(approvalClass)) return "amber";
  return "green";
}

function riskIcon(tier) {
  if (tier === "red") return "⛔";
  if (tier === "amber") return "⚠";
  return "✓";
}

function targetText(approval) {
  return [
    approval.relatedCapabilityId,
    ...(approval.relatedFilePaths || []),
    ...(approval.relatedArtifactIds || []),
  ].filter(Boolean).join(", ") || "No target identifier supplied.";
}

function renderFields(approval) {
  return `
    <div class="field-list">
      <div class="field">
        <div class="k">Target</div>
        <div class="v">${escapeHtml(targetText(approval))}</div>
      </div>
      <div class="field">
        <div class="k">Requested action</div>
        <div class="v"><strong>${escapeHtml(approval.title)}</strong><br>${escapeHtml(approval.summary)}</div>
      </div>
      <div class="field">
        <div class="k">Approval class</div>
        <div class="v">${escapeHtml(approval.approvalClass)}</div>
      </div>
      <div class="field">
        <div class="k">Boundary</div>
        <div class="v">${escapeHtml(approval.localBoundary)}</div>
      </div>
      <div class="field">
        <div class="k">Consequence</div>
        <div class="v">
          <strong>Checkpoint:</strong> ${escapeHtml(approval.checkpointPolicy)}
          <ul style="margin: 8px 0 0 18px; padding: 0; display: grid; gap: 4px;">
            ${(approval.riskNotes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("") || "<li>No risk notes were supplied.</li>"}
          </ul>
        </div>
      </div>
    </div>
  `;
}

function renderPreview(approval) {
  if (approval.previewAvailable) {
    return `
      <div class="approval-preview">
        <strong>Preview available</strong>
        <div style="margin-top: 6px;">${escapeHtml(approval.previewSummary || "The requesting capability marked a preview as available.")}</div>
      </div>
    `;
  }
  return `
    <div class="approval-preview no-preview">
      <strong>⚠ No preview</strong>
      <div style="margin-top: 6px;">${escapeHtml(approval.previewSummary || "The requesting capability did not provide a preview. Review the consequence and risk notes before deciding.")}</div>
    </div>
  `;
}

function renderResolved(approval) {
  const decision = approval.decision || {};
  const choice = decision.status === "rejected" ? "Denied" : "Approved";
  return `
    <div class="approval-resolved">
      <strong>${escapeHtml(choice)}</strong>
      <div style="margin-top: 6px;">
        Decided by ${escapeHtml(decision.decidedBy || "unknown reviewer")}
        at ${escapeHtml(decision.decidedAt || approval.updatedAt || "unknown time")}.
      </div>
      ${decision.reason ? `<div style="margin-top: 6px;"><strong>Reason:</strong> ${escapeHtml(decision.reason)}</div>` : ""}
    </div>
  `;
}

function renderPendingActions(approval) {
  return `
    <div class="approval-actions">
      <label class="approval-reason-wrap">
        Optional decision reason
        <input class="approval-reason" data-approval-reason="${escapeHtml(approval.id)}" type="text" maxlength="500" placeholder="Add context for the ledger" />
      </label>
      <button class="approval-action approve" type="button" data-approval-action="approved" data-approval-id="${escapeHtml(approval.id)}">Approve</button>
      <button class="approval-action deny" type="button" data-approval-action="rejected" data-approval-id="${escapeHtml(approval.id)}">Deny</button>
    </div>
    <div class="approval-error" data-approval-error="${escapeHtml(approval.id)}" role="status" aria-live="polite"></div>
  `;
}

function renderApproval(approval) {
  const tier = riskTier(approval.approvalClass);
  const pending = approval.status === "pending";
  return `
    <article class="timeline-card approval-card" data-approval-card="${escapeHtml(approval.id)}" data-risk-tier="${tier}" tabindex="0" aria-label="${escapeHtml(`${approval.title}, ${tier} risk, ${approval.status}`)}">
      <div class="timeline-topline">
        <strong>${escapeHtml(approval.actionSummary || approval.title)}</strong>
        <span class="approval-tier">${riskIcon(tier)} ${tier} · ${escapeHtml(approval.status)}</span>
      </div>
      ${renderFields(approval)}
      ${renderPreview(approval)}
      ${pending ? renderPendingActions(approval) : renderResolved(approval)}
    </article>
  `;
}

function renderApprovals(payload) {
  const approvals = payload?.approvals;
  if (!approvals) {
    statusElement.textContent = "Approval data unavailable";
    emptyElement.textContent = "The local approval queue could not be loaded. No decision was sent.";
    listElement.innerHTML = "";
    return;
  }

  statusElement.textContent = `${approvals.pendingCount} pending · ${approvals.totalCount} total`;
  if (!approvals.items.length) {
    emptyElement.textContent = approvals.emptyStateMessage;
    listElement.innerHTML = "";
    return;
  }

  emptyElement.innerHTML = "";
  listElement.innerHTML = approvals.items.map(renderApproval).join("");
}

async function loadApprovals() {
  try {
    const response = await fetch("/api/v1/workbench/approvals");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderApprovals(await response.json());
  } catch {
    renderApprovals(null);
  }
}

async function resolveApproval(button) {
  const approvalId = button.dataset.approvalId;
  const status = button.dataset.approvalAction;
  const card = button.closest("[data-approval-card]");
  const controls = card.querySelectorAll("button, input");
  const reasonInput = card.querySelector("[data-approval-reason]");
  const errorElement = card.querySelector("[data-approval-error]");
  controls.forEach((control) => { control.disabled = true; });
  errorElement.textContent = status === "approved" ? "Approving…" : "Denying…";

  try {
    const reason = reasonInput.value.trim();
    const response = await fetch(`/api/v1/approvals/${encodeURIComponent(approvalId)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        decidedBy: "workbench",
        ...(reason ? { reason } : {}),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    await loadApprovals();
    document.querySelector(`[data-approval-card="${CSS.escape(approvalId)}"]`)?.focus();
  } catch (error) {
    controls.forEach((control) => { control.disabled = false; });
    errorElement.textContent = `Decision not recorded: ${error instanceof Error ? error.message : String(error)}`;
    button.focus();
  }
}

listElement.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-approval-action]");
  if (button) void resolveApproval(button);
});

listElement.addEventListener("keydown", (event) => {
  const button = event.target.closest("button[data-approval-action]");
  if (button && event.key === "Enter") {
    event.preventDefault();
    void resolveApproval(button);
    return;
  }

  const card = event.target.closest("[data-approval-card]");
  if (!card || event.target !== card || event.key !== "Enter") return;
  event.preventDefault();
  card.querySelector("button[data-approval-action]")?.focus();
});

globalThis.__spectraWorkbenchLive = {
  ...(globalThis.__spectraWorkbenchLive || {}),
  loadApprovals,
};

void loadApprovals();
