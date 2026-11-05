const { runtimeState, clearRuntimeSession } = require("../session/runtime-state");

function buildUrl(baseUrl, pathName, query) {
  const url = new URL(pathName, `${baseUrl}/`);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function apiRequest({ baseUrl, method = "GET", pathName, headers = {}, body, query, timeoutMs = 8000 }) {
  if (typeof fetch !== "function") {
    throw new Error("fetch_unavailable");
  }

  const requestUrl = buildUrl(baseUrl, pathName, query);
  const controller = new AbortController();
  // timeoutMs <= 0 desactiva el abort — usado por llamadas que
  // sabemos largas/bloqueantes del lado del servidor (ffmpeg real en
  // /semantic/extract, llamada real a Gemini en /semantic/analyze).
  const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(requestUrl, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const rawText = await response.text();
    let data = null;
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch (_) {
        data = { raw: rawText };
      }
    }
    return {
      status: response.status,
      okHttp: response.ok,
      data,
      url: response.url
    };
  } catch (err) {
    if (err && err.name === "AbortError") {
      return {
        ok: false,
        error: "timeout_error",
        status: 0,
        okHttp: false,
        data: { ok: false, error: "timeout_error" },
        url: requestUrl
      };
    }
    console.error("[api-client] fetch failed", {
      url: requestUrl,
      message: err && err.message,
      cause: err && err.cause && String(err.cause),
      stack: err && err.stack,
    });
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function callViewApi(pathName, { method = "GET", body, query } = {}) {
  if (!runtimeState.session?.sessionToken || !runtimeState.session?.baseUrl) {
    return {
      ok: false,
      error: "not_logged_in",
      status: 401
    };
  }

  try {
    const result = await apiRequest({
      baseUrl: runtimeState.session.baseUrl,
      pathName,
      method,
      body,
      query,
      headers: {
        "x-view-session": runtimeState.session.sessionToken
      }
    });
    const payload = result.data && typeof result.data === "object" ? result.data : {};
    if (result.status === 401 && payload.error === "invalid_session") {
      clearRuntimeSession();
    }
    if (result.status === 403 && payload.error === "client_disabled") {
      clearRuntimeSession();
    }
    return {
      status: result.status,
      ...(payload || { ok: false, error: "invalid_response" })
    };
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      detail: String(err && err.message ? err.message : err),
      status: 0
    };
  }
}

module.exports = {
  buildUrl,
  apiRequest,
  callViewApi
};
