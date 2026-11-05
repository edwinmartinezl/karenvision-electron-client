// Renueva en segundo plano la sesión de login manual por código (ver
// main/ipc/kv-ipc.js → kv:view:login y login-panel.js en el renderer, modo
// "code"). /view/login no lleva usuario, solo el código de 6 dígitos, así
// que "renovar" es literalmente volver a llamar /view/login con el mismo
// código antes de que el session_token venza — igual de simple que el
// login inicial, sin necesidad de un endpoint de refresh aparte.
//
// Sin esto, la sesión por código expira sola a los 10 min
// (SESSION_TTL_SECONDS en view_service.py) y el operador tendría que
// volver a teclear el código todo el tiempo mientras usa la app sin
// internet.
const { runtimeState, setRuntimeSession, clearRuntimeSession } = require("./runtime-state");
const { apiRequest } = require("../api/api-client");

const REFRESH_MARGIN_MS = 90 * 1000; // renovar 90s antes de que venza el session_token
const RETRY_DELAY_MS = 15 * 1000;
const MAX_RETRIES = 4;

let _timer = null;

function stopCodeSessionRefresh() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}

function _scheduleNext(delayMs, retryCount = 0) {
  stopCodeSessionRefresh();
  _timer = setTimeout(() => _runRefresh(retryCount), Math.max(1000, delayMs));
}

async function _runRefresh(retryCount) {
  const session = runtimeState.session;
  // La sesión se cerró o cambió de tipo mientras esperábamos (logout,
  // cambio de base_url, sesión invalidada por el servidor) — no hay nada
  // que renovar.
  if (!session || !session.code || !session.baseUrl) return;

  try {
    const result = await apiRequest({
      baseUrl: session.baseUrl,
      method: "POST",
      pathName: "/view/login",
      body: { code: session.code },
    });
    const body = result.data && typeof result.data === "object" ? result.data : {};

    if (result.okHttp && body.ok) {
      setRuntimeSession(session.baseUrl, body, { code: session.code });
      const expiresInMs = Number(body.expires_in || 0) * 1000;
      _scheduleNext(expiresInMs - REFRESH_MARGIN_MS);
      return;
    }

    // Código rechazado (revocado/deshabilitado por un admin) — reintentar
    // no serviría de nada, hay que volver a pedir login.
    console.warn("[KV][code-session] refresh rechazado por el servidor:", body.error || result.status);
    clearRuntimeSession();
  } catch (err) {
    // Fallo de red hacia el SDK local (poco común, puede ser un reinicio
    // momentáneo del backend) — reintenta con backoff acotado antes de
    // rendirse.
    if (retryCount < MAX_RETRIES) {
      _scheduleNext(RETRY_DELAY_MS, retryCount + 1);
    } else {
      console.warn("[KV][code-session] refresh agotó reintentos:", err && err.message ? err.message : err);
      clearRuntimeSession();
    }
  }
}

// Se llama justo después de un login (o refresh) exitoso con expires_in
// en segundos, tal como lo devuelve /view/login.
function scheduleCodeSessionRefresh(expiresInSeconds) {
  _scheduleNext(Number(expiresInSeconds || 0) * 1000 - REFRESH_MARGIN_MS);
}

module.exports = { scheduleCodeSessionRefresh, stopCodeSessionRefresh };
