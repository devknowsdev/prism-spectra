function localToken() {
  const fromWindow = typeof window.__SPECTRA_LOCAL_TOKEN === "string" ? window.__SPECTRA_LOCAL_TOKEN.trim() : "";
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

function failure(type, endpoint, message, httpStatus = 0) {
  return {
    ok: false,
    type,
    endpoint,
    message,
    httpStatus,
  };
}

function classifyHttpFailure(endpoint, status, payload) {
  const message = typeof payload?.error === "string" && payload.error.trim()
    ? payload.error
    : `HTTP ${status}`;

  if (status === 401 || status === 403) {
    return failure("authentication_failure", endpoint, message, status);
  }
  if (status === 400 || status === 422) {
    return failure("validation_failure", endpoint, message, status);
  }
  if (status === 404 || status === 410) {
    return failure("unavailable", endpoint, message, status);
  }
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return failure("transient_failure", endpoint, message, status);
  }
  return failure("error", endpoint, message, status);
}

async function readJsonBody(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

export async function getJson(endpoint, validate) {
  const token = localToken();
  let response;

  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { "x-local-token": token } : {}),
      },
    });
  } catch {
    return failure("unavailable", endpoint, "The local daemon is unavailable.");
  }

  let payload = null;
  try {
    payload = await readJsonBody(response);
  } catch {
    return failure("validation_failure", endpoint, "The daemon returned invalid JSON.", response.status);
  }

  if (!response.ok) {
    return classifyHttpFailure(endpoint, response.status, payload);
  }

  if (typeof validate === "function") {
    const result = validate(payload);
    if (!result?.ok) {
      return failure("validation_failure", endpoint, result?.message || "The daemon returned an unexpected payload.", response.status);
    }
    payload = result.data;
  }

  return {
    ok: true,
    type: "success",
    endpoint,
    httpStatus: response.status,
    data: payload,
  };
}
