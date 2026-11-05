const { viewerWindows } = require("../windows/window-state");
const { readClientConfig } = require("../config/client-config");
const { persistSession, clearPersistedSession, loadFreshSession } = require("./persisted-session");

const runtimeState = {
  session: null,
  firebaseAuth: null
};

function clearRuntimeSession() {
  runtimeState.session = null;
}

// Guarda el ID token de Firebase obtenido en el login con Google (+ su
// refreshToken, usado por main/auth/token-refresh.js para renovarlo sin
// pedir login de nuevo cuando expira a la hora), usado como
// Authorization: Bearer <idToken> en los requests al API. Se persiste en
// disco (ver persisted-session.js) para no pedir login de nuevo si se
// cierra y reabre la app dentro de la ventana de inactividad.
function setFirebaseAuth(idToken, user, refreshToken, { persist = true } = {}) {
  runtimeState.firebaseAuth = {
    idToken,
    user: user || null,
    refreshToken: refreshToken || runtimeState.firebaseAuth?.refreshToken || null
  };
  if (persist) persistSession(idToken, user, runtimeState.firebaseAuth.refreshToken);
}

function clearFirebaseAuth() {
  runtimeState.firebaseAuth = null;
  clearPersistedSession();
}

// Al arrancar la app: si hay una sesión persistida vigente (dentro del
// timeout de inactividad), la restaura en memoria y devuelve el user.
// Si no, devuelve null (y ya se limpió cualquier archivo vencido).
function restoreFirebaseAuthIfFresh() {
  const restored = loadFreshSession();
  if (!restored) return null;
  setFirebaseAuth(restored.idToken, restored.user, restored.refreshToken, { persist: false });
  return restored.user;
}

function getFirebaseIdToken() {
  return runtimeState.firebaseAuth?.idToken || null;
}

function getFirebaseRefreshToken() {
  return runtimeState.firebaseAuth?.refreshToken || null;
}

function getFirebaseSessionInfo() {
  return {
    logged_in: Boolean(runtimeState.firebaseAuth?.idToken),
    user: runtimeState.firebaseAuth?.user || null
  };
}

// code: el código de 6 dígitos usado para obtener esta sesión (login manual
// sin internet, ver login-panel.js modo "code") — se guarda solo en memoria
// (nunca en disco) para que main/session/code-session-refresh.js pueda
// renovar la sesión sola llamando /view/login de nuevo antes de que venza.
// Si no se pasa un code nuevo, se conserva el que ya hubiera (p. ej. en cada
// renovación automática, que no vuelve a mandar el code explícito).
function setRuntimeSession(baseUrl, loginResponse, { code } = {}) {
  runtimeState.session = {
    baseUrl,
    sessionToken: loginResponse.session_token,
    expiresAt: Date.now() + Number(loginResponse.expires_in || 0) * 1000,
    client: loginResponse.client || null,
    code: code || runtimeState.session?.code || null
  };
}

function getWindowStats() {
  const current = viewerWindows.size;
  const max = runtimeState.session?.client?.max_windows;
  return {
    current_windows: current,
    max_windows: Number.isFinite(Number(max)) ? Number(max) : null
  };
}

function getSessionInfoPayload() {
  return {
    ok: true,
    logged_in: Boolean(runtimeState.session),
    base_url: runtimeState.session?.baseUrl || readClientConfig().base_url || null,
    active_group: null,
    client: runtimeState.session?.client || null,
    ...getWindowStats()
  };
}

module.exports = {
  runtimeState,
  clearRuntimeSession,
  setRuntimeSession,
  getWindowStats,
  getSessionInfoPayload,
  setFirebaseAuth,
  clearFirebaseAuth,
  getFirebaseIdToken,
  getFirebaseRefreshToken,
  getFirebaseSessionInfo,
  restoreFirebaseAuthIfFresh
};
