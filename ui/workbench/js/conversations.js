const originalFetch = globalThis.fetch.bind(globalThis);

const conversationState = {
  items: [],
  selectedId: null,
  selected: null,
  initialized: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function workbenchLocalToken() {
  const fromWindow = typeof globalThis.__SPECTRA_LOCAL_TOKEN === "string"
    ? globalThis.__SPECTRA_LOCAL_TOKEN.trim()
    : "";
  if (fromWindow) return fromWindow;
  try {
    return (
      localStorage.getItem("spectra.localToken")
      || localStorage.getItem("spectra.daemonToken")
      || localStorage.getItem("AI_FORGE_DAEMON_TOKEN")
      || ""
    ).trim();
  } catch {
    return "";
  }
}

function localJsonHeaders() {
  const token = workbenchLocalToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { "x-local-token": token } : {}),
  };
}

function positiveConversationId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function selectedConversationIdFromUrl() {
  const url = new URL(globalThis.location.href);
  return positiveConversationId(url.searchParams.get("conversationId"));
}

function updateConversationUrl(conversationId) {
  const url = new URL(globalThis.location.href);
  if (conversationId == null) {
    url.searchParams.delete("conversationId");
  } else {
    url.searchParams.set("conversationId", String(conversationId));
  }
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function injectStyles() {
  if (document.getElementById("workbench-conversation-styles")) return;
  const style = document.createElement("style");
  style.id = "workbench-conversation-styles";
  style.textContent = `
    .conversation-workspace {
      margin: 0 0 16px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface-2);
      display: grid;
      gap: 10px;
    }
    .conversation-workspace-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }
    .conversation-workspace-head strong { font-size: 14px; }
    .conversation-workspace-head span {
      color: var(--dim);
      font-size: 11px;
      font-family: var(--mono);
    }
    .conversation-workspace-controls {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(180px, 0.8fr) auto;
      gap: 8px;
      align-items: end;
    }
    .conversation-workspace-controls label {
      display: grid;
      gap: 6px;
      color: var(--dim);
      font-size: 11px;
      font-family: var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .conversation-workspace-controls select,
    .conversation-workspace-controls input,
    .conversation-workspace-controls button {
      min-height: 40px;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 9px 11px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }
    .conversation-workspace-controls button { cursor: pointer; }
    .conversation-workspace-controls button:disabled { cursor: wait; opacity: 0.65; }
    .conversation-mode-note {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .conversation-mode-note strong { color: var(--text); }
    .conversation-transcript {
      display: grid;
      gap: 12px;
    }
    .conversation-turn {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
      background: var(--surface-2);
      display: grid;
      gap: 10px;
    }
    .conversation-turn-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--dim);
      font-size: 11px;
      font-family: var(--mono);
    }
    .conversation-turn-block {
      display: grid;
      gap: 5px;
    }
    .conversation-turn-block .k {
      color: var(--dim);
      font-size: 10px;
      font-family: var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .conversation-turn-block .v {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.55;
      font-size: 13px;
    }
    @media (max-width: 860px) {
      .conversation-workspace-controls { grid-template-columns: 1fr; }
    }
  `;
  document.head.append(style);
}

function injectConversationUi() {
  const form = document.getElementById("console-form");
  const consoleSection = document.querySelector('section[data-section="console"] .stack');
  if (!(form instanceof HTMLFormElement) || !(consoleSection instanceof HTMLElement)) return false;

  if (!document.getElementById("console-conversation-workspace")) {
    const workspace = document.createElement("div");
    workspace.id = "console-conversation-workspace";
    workspace.className = "conversation-workspace";
    workspace.innerHTML = `
      <div class="conversation-workspace-head">
        <strong>Project conversation</strong>
        <span id="console-conversation-mode">one-shot</span>
      </div>
      <div class="conversation-workspace-controls">
        <label>
          Conversation
          <select id="console-conversation-select" aria-label="Selected project conversation">
            <option value="">One-shot local request (not saved)</option>
          </select>
        </label>
        <label>
          Optional title for a new conversation
          <input id="console-conversation-title" type="text" maxlength="120" placeholder="e.g. F3b architecture" />
        </label>
        <button id="console-conversation-create" type="button">Create conversation</button>
      </div>
      <div class="conversation-mode-note" id="console-conversation-note">
        One-shot mode keeps the current F2/F3a behaviour: local request, visible answer, no project transcript.
      </div>
      <div class="conversation-mode-note">
        <strong>Why Prism:</strong> project continuity is explicit and local. Selecting a conversation stores the visible prompt and response in Spectra, while prior turns remain out of the model request unless a later reviewed capability deliberately attaches them.
      </div>
    `;
    form.before(workspace);
  }

  if (!document.getElementById("console-transcript-card")) {
    const transcriptCard = document.createElement("div");
    transcriptCard.id = "console-transcript-card";
    transcriptCard.className = "card";
    transcriptCard.innerHTML = `
      <div class="section-title">
        <h3>Conversation transcript</h3>
        <span id="console-transcript-status">No persistent conversation selected</span>
      </div>
      <div class="conversation-transcript" id="console-transcript" aria-live="polite">
        <div class="empty">Select or create a conversation to keep a local project transcript.</div>
      </div>
    `;
    const evidenceCard = document.getElementById("console-surface-observation-panel")?.closest(".card");
    if (evidenceCard) {
      consoleSection.insertBefore(transcriptCard, evidenceCard);
    } else {
      consoleSection.append(transcriptCard);
    }
  }

  return true;
}

function conversationLabel(item) {
  const title = typeof item?.title === "string" && item.title.trim()
    ? item.title.trim()
    : `Conversation ${item?.id ?? "?"}`;
  const count = Number.isFinite(item?.messageCount) ? Number(item.messageCount) : 0;
  return `${title} · ${count} turn${count === 1 ? "" : "s"}`;
}

function renderConversationSelect() {
  const select = document.getElementById("console-conversation-select");
  if (!(select instanceof HTMLSelectElement)) return;
  const previous = conversationState.selectedId;
  select.replaceChildren();
  const oneShot = document.createElement("option");
  oneShot.value = "";
  oneShot.textContent = "One-shot local request (not saved)";
  select.append(oneShot);
  for (const item of conversationState.items) {
    const option = document.createElement("option");
    option.value = String(item.id);
    option.textContent = conversationLabel(item);
    select.append(option);
  }
  select.value = previous == null ? "" : String(previous);
}

function renderConversationMode() {
  const mode = document.getElementById("console-conversation-mode");
  const note = document.getElementById("console-conversation-note");
  if (conversationState.selectedId == null) {
    if (mode) mode.textContent = "one-shot";
    if (note) note.textContent = "One-shot mode keeps the current F2/F3a behaviour: local request, visible answer, no project transcript.";
    return;
  }

  const title = conversationState.selected?.title
    || conversationState.items.find((item) => item.id === conversationState.selectedId)?.title
    || `Conversation ${conversationState.selectedId}`;
  if (mode) mode.textContent = `persistent · #${conversationState.selectedId}`;
  if (note) {
    note.textContent = `${title} is selected. New completed turns are stored locally in Spectra. Previous turns are displayed here but are not automatically sent back to the model.`;
  }
}

function renderTranscript(conversation) {
  const status = document.getElementById("console-transcript-status");
  const transcript = document.getElementById("console-transcript");
  if (!(transcript instanceof HTMLElement)) return;

  if (!conversation) {
    if (status) status.textContent = "No persistent conversation selected";
    transcript.innerHTML = '<div class="empty">Select or create a conversation to keep a local project transcript.</div>';
    return;
  }

  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const title = conversation.title || `Conversation ${conversation.id}`;
  if (status) status.textContent = `${title} · ${messages.length} turn${messages.length === 1 ? "" : "s"} · local SQLite`;
  if (messages.length === 0) {
    transcript.innerHTML = '<div class="empty">This conversation is ready. Send a local request to add its first visible turn.</div>';
    return;
  }

  transcript.innerHTML = messages.map((message, index) => `
    <article class="conversation-turn" data-conversation-turn="${escapeHtml(message.id ?? index + 1)}">
      <div class="conversation-turn-head">
        <span>turn ${index + 1}</span>
        <span>${escapeHtml(message.createdAt || "time unknown")} · ${escapeHtml(message.provider || "local")}${message.model ? `/${escapeHtml(message.model)}` : ""}</span>
      </div>
      <div class="conversation-turn-block">
        <div class="k">Dave</div>
        <div class="v">${escapeHtml(message.prompt || "")}</div>
      </div>
      <div class="conversation-turn-block">
        <div class="k">Prism</div>
        <div class="v">${escapeHtml(message.response || "")}</div>
      </div>
    </article>
  `).join("");
}

async function loadSelectedConversation() {
  const id = conversationState.selectedId;
  if (id == null) {
    conversationState.selected = null;
    renderConversationMode();
    renderTranscript(null);
    return null;
  }

  const response = await originalFetch(`/api/v1/workbench/conversations/${id}`);
  if (!response.ok) {
    conversationState.selectedId = null;
    conversationState.selected = null;
    updateConversationUrl(null);
    renderConversationSelect();
    renderConversationMode();
    renderTranscript(null);
    throw new Error(response.status === 404 ? "Selected conversation no longer exists." : `Could not load conversation (HTTP ${response.status}).`);
  }

  const payload = await response.json();
  conversationState.selected = payload?.conversation ?? null;
  renderConversationMode();
  renderTranscript(conversationState.selected);
  return conversationState.selected;
}

function syncLegacyConversationSelection() {
  if (conversationState.selectedId == null) return;
  const button = document.querySelector(`#conversations-list button[data-conversation-id="${CSS.escape(String(conversationState.selectedId))}"]`);
  if (!(button instanceof HTMLButtonElement)) return;
  if (button.getAttribute("aria-pressed") !== "true") button.click();
}

async function loadConversationList({ restoreFromUrl = false } = {}) {
  const response = await originalFetch("/api/v1/workbench/conversations?limit=100");
  if (!response.ok) throw new Error(`Could not load conversations (HTTP ${response.status}).`);
  const payload = await response.json();
  conversationState.items = Array.isArray(payload?.conversations?.items)
    ? payload.conversations.items.map((item) => ({ ...item, id: positiveConversationId(item.id) })).filter((item) => item.id != null)
    : [];

  if (restoreFromUrl) {
    const requestedId = selectedConversationIdFromUrl();
    conversationState.selectedId = requestedId && conversationState.items.some((item) => item.id === requestedId)
      ? requestedId
      : null;
    if (requestedId && conversationState.selectedId == null) updateConversationUrl(null);
  } else if (
    conversationState.selectedId != null
    && !conversationState.items.some((item) => item.id === conversationState.selectedId)
  ) {
    conversationState.selectedId = null;
    conversationState.selected = null;
    updateConversationUrl(null);
  }

  renderConversationSelect();
  await loadSelectedConversation();
  queueMicrotask(syncLegacyConversationSelection);
}

async function selectConversation(conversationId, { updateUrl = true } = {}) {
  const id = positiveConversationId(conversationId);
  if (id != null && !conversationState.items.some((item) => item.id === id)) {
    await loadConversationList();
  }
  conversationState.selectedId = id != null && conversationState.items.some((item) => item.id === id) ? id : null;
  conversationState.selected = null;
  if (updateUrl) updateConversationUrl(conversationState.selectedId);
  renderConversationSelect();
  await loadSelectedConversation();
  syncLegacyConversationSelection();
}

async function createConversation() {
  const button = document.getElementById("console-conversation-create");
  const titleInput = document.getElementById("console-conversation-title");
  const title = titleInput instanceof HTMLInputElement ? titleInput.value.trim().slice(0, 120) : "";
  if (button instanceof HTMLButtonElement) button.disabled = true;
  try {
    const response = await originalFetch("/api/v1/conversations", {
      method: "POST",
      headers: localJsonHeaders(),
      body: JSON.stringify({ title: title || null }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    const id = positiveConversationId(payload?.id);
    if (id == null) throw new Error("Conversation creation returned no valid ID.");
    if (titleInput instanceof HTMLInputElement) titleInput.value = "";
    if (typeof globalThis.loadConversations === "function") {
      await globalThis.loadConversations().catch(() => {});
    }
    await loadConversationList();
    await selectConversation(id);
  } finally {
    if (button instanceof HTMLButtonElement) button.disabled = false;
  }
}

async function persistCompletedTurn(conversationId, requestBody, responsePayload) {
  const prompt = typeof requestBody?.input?.prompt === "string" ? requestBody.input.prompt.trim() : "";
  const responseText = typeof responsePayload?.response === "string" ? responsePayload.response : "";
  if (!prompt) throw new Error("The completed request had no prompt to store.");

  const response = await originalFetch(`/api/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: localJsonHeaders(),
    body: JSON.stringify({
      role: "assistant",
      provider: typeof responsePayload?.provider === "string" ? responsePayload.provider : "ollama",
      model: typeof responsePayload?.model === "string" ? responsePayload.model : null,
      prompt,
      response: responseText,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || positiveConversationId(payload?.id) == null) {
    throw new Error(payload?.error || `Transcript write failed (HTTP ${response.status}).`);
  }
}

function jsonFailure(status, error) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function persistentConversationFetch(input, init) {
  const requestUrl = new URL(typeof input === "string" ? input : input.url, globalThis.location.href);
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (requestUrl.pathname !== "/api/v1/ai/request" || method !== "POST") {
    return originalFetch(input, init);
  }

  let bodyText = init?.body;
  if (bodyText == null && input instanceof Request) bodyText = await input.clone().text();
  if (typeof bodyText !== "string") return originalFetch(input, init);

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return originalFetch(input, init);
  }
  if (body?.sourceApp !== "prism-spectra" || body?.intent !== "workbench-chat") {
    return originalFetch(input, init);
  }

  const selectedId = conversationState.selectedId;
  if (selectedId != null) {
    if (!conversationState.selected || conversationState.selected.id !== selectedId) {
      try {
        await loadSelectedConversation();
      } catch (error) {
        return jsonFailure(409, error instanceof Error ? error.message : String(error));
      }
    }
    body.preferredMode = "local-only";
    body.record = false;
  }

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  for (const [key, value] of new Headers(init?.headers || {}).entries()) headers.set(key, value);
  headers.set("Content-Type", "application/json");
  const nextInit = {
    ...init,
    method: "POST",
    headers,
    body: JSON.stringify(body),
  };
  const response = await originalFetch(typeof input === "string" ? input : input.url, nextInit);
  if (selectedId == null || !response.ok) return response;

  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return jsonFailure(502, "The local AI response was not valid JSON, so no transcript turn was stored.");
  }
  if (payload?.ok !== true) return response;

  try {
    await persistCompletedTurn(selectedId, body, payload);
    await loadConversationList();
    if (typeof globalThis.loadResume === "function") await globalThis.loadResume().catch(() => {});
    if (typeof globalThis.loadConversations === "function") await globalThis.loadConversations().catch(() => {});
    queueMicrotask(syncLegacyConversationSelection);
    return response;
  } catch (error) {
    return jsonFailure(
      500,
      `A local response was generated but was not reported as complete because the selected conversation could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function wireConversationUi() {
  const select = document.getElementById("console-conversation-select");
  const createButton = document.getElementById("console-conversation-create");
  const legacyList = document.getElementById("conversations-list");

  select?.addEventListener("change", () => {
    void selectConversation(select instanceof HTMLSelectElement ? select.value : null).catch((error) => {
      const note = document.getElementById("console-conversation-note");
      if (note) note.textContent = `Conversation selection failed: ${error instanceof Error ? error.message : String(error)}`;
    });
  });

  createButton?.addEventListener("click", () => {
    void createConversation().catch((error) => {
      const note = document.getElementById("console-conversation-note");
      if (note) note.textContent = `Conversation creation failed: ${error instanceof Error ? error.message : String(error)}`;
    });
  });

  legacyList?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-conversation-id]") : null;
    const id = positiveConversationId(button?.getAttribute("data-conversation-id"));
    if (id != null) void selectConversation(id).catch(() => {});
  });

  if (legacyList) {
    const observer = new MutationObserver(() => queueMicrotask(syncLegacyConversationSelection));
    observer.observe(legacyList, { childList: true, subtree: true });
  }
}

async function initPersistentConversations() {
  if (conversationState.initialized) return;
  conversationState.initialized = true;
  injectStyles();
  if (!injectConversationUi()) return;
  globalThis.fetch = persistentConversationFetch;
  wireConversationUi();
  try {
    await loadConversationList({ restoreFromUrl: true });
  } catch (error) {
    const note = document.getElementById("console-conversation-note");
    if (note) note.textContent = `Conversation store unavailable: ${error instanceof Error ? error.message : String(error)} One-shot local requests remain available.`;
    renderConversationMode();
    renderTranscript(null);
  }
}

void initPersistentConversations();
