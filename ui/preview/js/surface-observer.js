(() => {
  const PROTOCOL_VERSION = "spectra.surfaceObservation.v1";
  const REQUEST_TYPE = "spectra.surface.inspect.request";
  const RESPONSE_TYPE = "spectra.surface.inspect.response";
  const MAX_PACKET_BYTES = 24 * 1024;
  const MAX_BODY_TEXT = 6000;
  const CAPS = {
    headings: 30,
    landmarks: 20,
    buttons: 40,
    links: 40,
    formLabels: 40,
    states: 160,
    statusText: 20,
    errorText: 20,
    observerErrors: 10,
    unhandledRejections: 10,
  };
  const TEXT_LIMITS = {
    heading: 160,
    landmark: 160,
    control: 160,
    status: 240,
    error: 240,
    observerError: 240,
  };
  const CREDENTIAL_PATTERN =
    /(password|passwd|secret|token|api[-_ ]?key|apikey|credential|authorization|github[-_ ]?token|publish[-_ ]?token)/i;
  const HIDDEN_SELECTOR = "[hidden],[aria-hidden='true']";
  const EXCLUDED_TEXT_SELECTOR =
    "[hidden],[aria-hidden='true'],script,style,template,noscript,input,textarea,select,option";

  const observerErrors = [];
  const unhandledRejections = [];
  const processedRequestIds = new Set();

  function isCanonicalLoopbackOrigin(origin) {
    try {
      const url = new URL(origin);
      return (
        (url.protocol === "http:" || url.protocol === "https:")
        && !url.username
        && !url.password
        && url.pathname === "/"
        && !url.search
        && !url.hash
        && origin === url.origin
        && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]")
      );
    } catch {
      return false;
    }
  }

  function configuredWorkbenchOrigin() {
    const config = window.__SPECTRA_SURFACE_OBSERVER;
    if (!config || typeof config !== "object" || Array.isArray(config)) return "";
    const origin = config.workbenchOrigin;
    return typeof origin === "string" && isCanonicalLoopbackOrigin(origin) ? origin : "";
  }

  const WORKBENCH_ORIGIN = configuredWorkbenchOrigin();

  function countRecord() {
    return Object.create(null);
  }

  function increment(record, key, amount = 1) {
    record[key] = (record[key] || 0) + amount;
  }

  function packetByteSize(value) {
    return new TextEncoder().encode(JSON.stringify(value || {})).length;
  }

  function recordRedaction(redactions, key) {
    if (redactions) increment(redactions, key);
  }

  function redactUrl(value, redactions) {
    try {
      const url = new URL(value);
      const hadSecretSurface = Boolean(url.search || url.hash || url.username || url.password);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      if (hadSecretSurface) recordRedaction(redactions, "urlCredentials");
      return `${url.origin}${url.pathname}`;
    } catch {
      recordRedaction(redactions, "urlCredentials");
      return "[redacted-url]";
    }
  }

  function redactCredentialValues(value, redactions, options = {}) {
    let text = String(value || "");
    const quotedOrSingleToken = String.raw`(?:"[^"]*"|'[^']*'|[^\s"'&<>]+)`;
    const digestValue = String.raw`(?:"[^"]*"|'[^']*'|[^,;\s"'&<>]+)`;
    const digestParam = String.raw`[A-Za-z][A-Za-z0-9_-]*\s*=\s*${digestValue}`;
    const redactLocalPaths = options.redactLocalPaths !== false;
    const replacements = [
      [new RegExp(String.raw`\bAuthorization\s*[:=]\s*Digest\s+${digestParam}(?:\s*,\s*${digestParam})*`, "gi"), "[redacted-credential]", "authorization"],
      [new RegExp(String.raw`\bAuthorization\s*[:=]\s*(?:Bearer|Basic|Token|Digest|ApiKey)\s+${quotedOrSingleToken}`, "gi"), "[redacted-credential]", "authorization"],
      [new RegExp(String.raw`\bAuthorization\s*:\s*Bearer\s+${quotedOrSingleToken}`, "gi"), "[redacted-credential]", "authorization"],
      [new RegExp(String.raw`\bBearer\s+${quotedOrSingleToken}`, "gi"), "[redacted-credential]", "bearer"],
      [new RegExp(String.raw`\b(token|secret|password|passwd|api[\s_-]*key|apikey|credential|authorization)\b\s*[:=]\s*${quotedOrSingleToken}`, "gi"), "[redacted-credential]", "keyValue"],
      [/\b(api\s+token|api\s+key|authorization|credential|password|secret|token)\b\s+(?:bearer\s+)?([A-Za-z0-9._~+/=-]{8,})/gi, (_match, key) => `${key} [redacted]`, "pairedValue"],
      [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-jwt]", "jwt"],
      [/[?&](?:token|secret|password|api_key|apikey|credential|authorization)=[^&#\s]+/gi, "[redacted-query]", "queryValues"],
      [/#[^\s"'<>]+/g, "[redacted-fragment]", "urlFragments"],
    ];
    const localPathReplacements = [
      [/(^|[\s("'=])file:[^"'<>]*?(?=\s+(?:Authorization|file:|https?:\/\/|[A-Za-z][A-Za-z0-9_-]*\s*[:=]|\/(?:Users|home|root|private|var|tmp|Volumes|mnt|media|etc|opt|srv)\/|[A-Za-z]:[\\/])|$)/gi, (_match, prefix) => `${prefix}[redacted-file-url]`, "fileUrls"],
      [/file:[^\s"'<>]*/gi, "[redacted-file-url]", "fileUrls"],
      [/(^|[\s("'=])(?:\/Users|\/home|\/root|\/private|\/var|\/tmp|\/Volumes|\/mnt|\/media|\/etc|\/opt|\/srv)\/[^"'<>]*?(?=\s+(?:Authorization|file:|https?:\/\/|[A-Za-z][A-Za-z0-9_-]*\s*[:=]|\/(?:Users|home|root|private|var|tmp|Volumes|mnt|media|etc|opt|srv)\/|[A-Za-z]:[\\/])|$)/g, (_match, prefix) => `${prefix}[redacted-path]`, "filePaths"],
      [/(^|[\s("'=])[A-Za-z]:[\\/][^"'<>]*?(?=\s+(?:Authorization|file:|https?:\/\/|[A-Za-z][A-Za-z0-9_-]*\s*[:=]|\/(?:Users|home|root|private|var|tmp|Volumes|mnt|media|etc|opt|srv)\/|[A-Za-z]:[\\/])|$)/g, (_match, prefix) => `${prefix}[redacted-path]`, "filePaths"],
      [/(^|[\s("'=])(?:\/Users|\/home|\/root|\/private|\/var|\/tmp|\/Volumes|\/mnt|\/media|\/etc|\/opt|\/srv)\/[^\s"'<>]+/g, (_match, prefix) => `${prefix}[redacted-path]`, "filePaths"],
      [/(^|[\s("'=])[A-Za-z]:[\\/][^"'<>]*?\.[A-Za-z0-9]{1,8}/g, (_match, prefix) => `${prefix}[redacted-path]`, "filePaths"],
      [/(^|[\s("'=])[A-Za-z]:[\\/][^\s"'<>]+/g, (_match, prefix) => `${prefix}[redacted-path]`, "filePaths"],
    ];

    text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => redactUrl(match, redactions));
    const orderedReplacements = redactLocalPaths ? localPathReplacements.concat(replacements) : replacements;
    for (const [pattern, replacement, key] of orderedReplacements) {
      text = text.replace(pattern, (...args) => {
        recordRedaction(redactions, key);
        return typeof replacement === "function" ? replacement(...args) : replacement;
      });
    }
    return text;
  }

  function truncateText(value, max, truncation, field, redactions) {
    const text = redactCredentialValues(String(value || "").replace(/\s+/g, " ").trim(), redactions);
    if (text.length <= max) return text;
    increment(truncation, field);
    return text.slice(0, max);
  }

  function safeUrlPath(value, redactions) {
    try {
      const url = new URL(value, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        recordRedaction(redactions, "nonHttpUrls");
        return "[redacted-non-http-url]";
      }
      if (url.username || url.password || url.search || url.hash) {
        recordRedaction(redactions, "urlCredentials");
      }
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      const safePath = redactCredentialValues(url.pathname, redactions, { redactLocalPaths: false });
      return `${url.origin}${safePath}`;
    } catch {
      return "";
    }
  }

  function suppressesRender(element) {
    if (!(element instanceof Element) || !element.isConnected) return true;
    if (element.matches(HIDDEN_SELECTOR)) return true;
    const style = window.getComputedStyle(element);
    return (
      style.display === "none"
      || style.visibility === "hidden"
      || style.visibility === "collapse"
      || Number(style.opacity) === 0
    );
  }

  function suppressesText(element) {
    return suppressesRender(element) || element.matches(EXCLUDED_TEXT_SELECTOR);
  }

  function hasSuppressedAncestor(element, stopAt, predicate = suppressesText) {
    for (let current = element; current && current instanceof Element; current = current.parentElement) {
      if (predicate(current)) return true;
      if (current === stopAt) break;
    }
    return false;
  }

  function visibleRect(element) {
    if (!(element instanceof Element) || hasSuppressedAncestor(element, document.documentElement, suppressesRender)) return null;
    const rects = Array.from(element.getClientRects());
    return rects.find((rect) => rect.width > 0 && rect.height > 0) || null;
  }

  function isVisible(element) {
    return Boolean(visibleRect(element));
  }

  function textNodeRendered(textNode) {
    try {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rendered = Array.from(range.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
      range.detach();
      return rendered;
    } catch {
      return false;
    }
  }

  function visibleText(element, max, truncation, field, redactions) {
    if (!isVisible(element)) return "";
    const parts = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || !node.isConnected) return NodeFilter.FILTER_REJECT;
          if (hasSuppressedAncestor(parent, element)) return NodeFilter.FILTER_REJECT;
          if (!textNodeRendered(node)) return NodeFilter.FILTER_REJECT;
          return String(node.nodeValue || "").trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      },
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      parts.push(node.nodeValue || "");
    }
    return truncateText(parts.join(" "), max, truncation, field, redactions);
  }

  function labelForControl(element, truncation, redactions) {
    const labels = [];
    if (typeof element.id === "string" && element.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (explicit && isVisible(explicit)) labels.push(visibleText(explicit, TEXT_LIMITS.control, truncation, "formLabelsText", redactions));
    }
    if (element.labels) {
      for (const label of Array.from(element.labels)) {
        if (isVisible(label)) labels.push(visibleText(label, TEXT_LIMITS.control, truncation, "formLabelsText", redactions));
      }
    }
    const aria = element.getAttribute("aria-label") || element.getAttribute("placeholder") || "";
    if (aria) labels.push(aria);
    return truncateText(labels.filter(Boolean).join(" "), TEXT_LIMITS.control, truncation, "formLabelsText", redactions);
  }

  function isSensitiveControl(element, label) {
    const type = String(element.getAttribute("type") || element.tagName || "").toLowerCase();
    const fields = [
      type,
      element.getAttribute("name") || "",
      element.id || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("placeholder") || "",
      element.getAttribute("autocomplete") || "",
      label || "",
    ].join(" ");
    return type === "password" || type === "file" || type === "hidden" || CREDENTIAL_PATTERN.test(fields);
  }

  function pushCapped(list, cap, item, truncation, field) {
    if (list.length >= cap) {
      increment(truncation, field);
      return false;
    }
    list.push(item);
    return true;
  }

  function summarizeError(value, max, truncation, field) {
    const raw = value instanceof Error ? value.message : String(value || "");
    const withoutStack = raw.split("\n")[0];
    const redactions = countRecord();
    const redacted = redactCredentialValues(withoutStack, redactions);
    return truncateText(redacted, max, truncation, field, redactions);
  }

  function collectObservation(mountId) {
    const truncation = countRecord();
    const redactions = countRecord();
    const headings = [];
    const landmarks = [];
    const buttons = [];
    const links = [];
    const formLabels = [];
    const states = [];
    const statusText = [];
    const errorText = [];

    for (const heading of document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")) {
      if (!isVisible(heading)) continue;
      pushCapped(headings, CAPS.headings, {
        level: heading.tagName && /^H[1-6]$/i.test(heading.tagName) ? Number(heading.tagName.slice(1)) : null,
        text: visibleText(heading, TEXT_LIMITS.heading, truncation, "headingsText", redactions),
      }, truncation, "headings");
    }

    for (const landmark of document.querySelectorAll("main,nav,header,footer,aside,section,[role='main'],[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary'],[role='region']")) {
      if (!isVisible(landmark)) continue;
      const label = landmark.getAttribute("aria-label") || landmark.getAttribute("role") || landmark.tagName.toLowerCase();
      pushCapped(landmarks, CAPS.landmarks, {
        element: landmark.tagName.toLowerCase(),
        role: landmark.getAttribute("role") || null,
        label: truncateText(label, TEXT_LIMITS.landmark, truncation, "landmarksText", redactions),
      }, truncation, "landmarks");
    }

    for (const button of document.querySelectorAll("button,[role='button']")) {
      if (!isVisible(button)) continue;
      if (button instanceof HTMLInputElement) continue;
      const label = visibleText(button, TEXT_LIMITS.control, truncation, "buttonsText", redactions);
      const item = {
        element: button.tagName.toLowerCase(),
        label: truncateText(label || button.getAttribute("aria-label") || "", TEXT_LIMITS.control, truncation, "buttonsText", redactions),
        disabled: Boolean(button.disabled || button.getAttribute("aria-disabled") === "true"),
        expanded: button.getAttribute("aria-expanded") === "true" ? true : button.getAttribute("aria-expanded") === "false" ? false : null,
        pressed: button.getAttribute("aria-pressed") === "true" ? true : button.getAttribute("aria-pressed") === "false" ? false : null,
      };
      if (pushCapped(buttons, CAPS.buttons, item, truncation, "buttons")) {
        pushCapped(states, CAPS.states, { kind: "button", label: item.label, disabled: item.disabled, expanded: item.expanded, pressed: item.pressed }, truncation, "states");
      }
    }

    for (const link of document.querySelectorAll("a[href]")) {
      if (!isVisible(link)) continue;
      pushCapped(links, CAPS.links, {
        label: visibleText(link, TEXT_LIMITS.control, truncation, "linksText", redactions),
        href: safeUrlPath(link.href, redactions),
      }, truncation, "links");
    }

    for (const control of document.querySelectorAll("input,textarea,select")) {
      if (!isVisible(control)) continue;
      const label = labelForControl(control, truncation, redactions);
      const sensitive = isSensitiveControl(control, label);
      const type = String(control.getAttribute("type") || control.tagName).toLowerCase();
      if (sensitive) increment(redactions, "sensitiveControls");
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
        increment(redactions, "formValuesOmitted");
      }
      const item = {
        element: control.tagName.toLowerCase(),
        type,
        label,
        redacted: true,
        disabled: Boolean(control.disabled),
        checked: control instanceof HTMLInputElement && typeof control.checked === "boolean" ? control.checked : null,
        selected: control instanceof HTMLSelectElement ? control.selectedIndex >= 0 : null,
        expanded: control.getAttribute("aria-expanded") === "true" ? true : control.getAttribute("aria-expanded") === "false" ? false : null,
      };
      if (pushCapped(formLabels, CAPS.formLabels, item, truncation, "formLabels")) {
        pushCapped(states, CAPS.states, { kind: "form", label, disabled: item.disabled, checked: item.checked, selected: item.selected, expanded: item.expanded }, truncation, "states");
      }
    }

    for (const status of document.querySelectorAll("[role='status'],[role='alert'],.status,.toast,.banner,[aria-live]")) {
      if (!isVisible(status)) continue;
      pushCapped(statusText, CAPS.statusText, visibleText(status, TEXT_LIMITS.status, truncation, "statusTextEntries", redactions), truncation, "statusText");
    }

    for (const error of document.querySelectorAll("[role='alert'],.error,.danger,.invalid,[aria-invalid='true']")) {
      if (!isVisible(error)) continue;
      pushCapped(errorText, CAPS.errorText, visibleText(error, TEXT_LIMITS.error, truncation, "errorTextEntries", redactions), truncation, "errorText");
    }

    const bodyText = visibleText(document.body, MAX_BODY_TEXT, truncation, "visibleBodyText", redactions);
    const packet = {
      schemaVersion: PROTOCOL_VERSION,
      mountId,
      appId: mountId === "focus" ? "focus" : "epk",
      origin: window.location.origin,
      path: window.location.pathname,
      documentTitle: truncateText(document.title || "", 200, truncation, "documentTitle"),
      capturedAt: new Date().toISOString(),
      headings,
      landmarks,
      buttons,
      links,
      formLabels,
      states,
      statusText: statusText.filter(Boolean),
      errorText: errorText.filter(Boolean),
      visibleBodyText: bodyText,
      observerErrors: observerErrors.slice(0, CAPS.observerErrors),
      unhandledRejections: unhandledRejections.slice(0, CAPS.unhandledRejections),
      truncation,
      redactions,
    };

    shrinkToLimit(packet);
    return packet;
  }

  function minimalPacket(packet) {
    return {
      schemaVersion: PROTOCOL_VERSION,
      mountId: String(packet.mountId || "").slice(0, 120),
      appId: String(packet.appId || "").slice(0, 120),
      origin: String(packet.origin || "").slice(0, 240),
      path: String(packet.path || "").slice(0, 400),
      documentTitle: String(packet.documentTitle || "").slice(0, 120),
      capturedAt: String(packet.capturedAt || new Date().toISOString()).slice(0, 80),
      headings: [],
      landmarks: [],
      buttons: [],
      links: [],
      formLabels: [],
      states: [],
      statusText: [],
      errorText: [],
      visibleBodyText: "",
      observerErrors: [],
      unhandledRejections: [],
      truncation: { packetBytes: 1, packetMinimized: 1 },
      redactions: {},
    };
  }

  function shrinkToLimit(packet) {
    const textFields = [
      ["visibleBodyText", 1000],
      ["statusText", 120],
      ["errorText", 120],
      ["observerErrors", 120],
      ["unhandledRejections", 120],
      ["buttons", 100],
      ["links", 100],
      ["headings", 100],
      ["landmarks", 100],
      ["formLabels", 100],
      ["states", 100],
    ];
    for (const [field, limit] of textFields) {
      if (packetByteSize(packet) <= MAX_PACKET_BYTES) return;
      if (typeof packet[field] === "string") {
        packet[field] = packet[field].slice(0, limit);
      } else if (Array.isArray(packet[field])) {
        packet[field] = packet[field].slice(0, Math.max(1, Math.floor(packet[field].length / 2)));
      }
      increment(packet.truncation, "packetBytes");
    }
    while (packetByteSize(packet) > MAX_PACKET_BYTES && packet.visibleBodyText) {
      packet.visibleBodyText = packet.visibleBodyText.slice(0, Math.max(0, packet.visibleBodyText.length - 500));
      increment(packet.truncation, "packetBytes");
    }
    if (packetByteSize(packet) > MAX_PACKET_BYTES) {
      const reduced = minimalPacket(packet);
      for (const key of Object.keys(packet)) delete packet[key];
      Object.assign(packet, reduced);
    }
    if (packetByteSize(packet) > MAX_PACKET_BYTES) {
      packet.documentTitle = "";
      packet.path = "";
      packet.truncation = { packetBytes: 1, packetMinimized: 1, packetCoreOnly: 1 };
    }
  }

  window.addEventListener("error", (event) => {
    if (observerErrors.length >= CAPS.observerErrors) return;
    const truncation = countRecord();
    observerErrors.push({
      type: "error",
      message: summarizeError(event.message || event.error, TEXT_LIMITS.observerError, truncation, "observerErrorsText"),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (unhandledRejections.length >= CAPS.unhandledRejections) return;
    const truncation = countRecord();
    unhandledRejections.push({
      type: "unhandledrejection",
      message: summarizeError(event.reason, TEXT_LIMITS.observerError, truncation, "unhandledRejectionsText"),
    });
  });

  window.addEventListener("message", (event) => {
    if (!WORKBENCH_ORIGIN) return;
    if (event.source !== window.parent) return;
    if (event.origin !== WORKBENCH_ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== REQUEST_TYPE || data.schemaVersion !== PROTOCOL_VERSION) return;
    if (typeof data.requestId !== "string" || !/^[a-zA-Z0-9._:-]{8,120}$/.test(data.requestId)) return;
    if (typeof data.mountId !== "string" || !["epk-publisher", "epk-admin", "focus"].includes(data.mountId)) return;
    if (processedRequestIds.has(data.requestId)) return;
    processedRequestIds.add(data.requestId);
    if (processedRequestIds.size > 200) {
      const oldest = processedRequestIds.values().next().value;
      processedRequestIds.delete(oldest);
    }

    const observation = collectObservation(data.mountId);
    window.parent.postMessage({
      type: RESPONSE_TYPE,
      schemaVersion: PROTOCOL_VERSION,
      requestId: data.requestId,
      mountId: data.mountId,
      observation,
    }, WORKBENCH_ORIGIN);
  });
})();
