const path = require("path");
const fs = require("fs");
const { app } = require("electron");

// Sesión de Google persistida en disco (userData, fuera del repo) para que
// cerrar y reabrir la app no pida login de nuevo — solo si pasaron más de
// IDLE_TIMEOUT_MS sin actividad (touchLastActive) se descarta y hay que
// volver a loguearse. El idToken de Firebase expira a la hora, pero el
// refreshToken (también persistido) permite renovarlo sin pedir login —
// ver main/auth/token-refresh.js.
const FILE_NAME = "firebase_session.json";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

function _path() {
  return path.join(app.getPath("userData"), FILE_NAME);
}

function persistSession(idToken, user, refreshToken) {
  try {
    // Si no viene un refreshToken nuevo (p.ej. una llamada que solo
    // actualiza el idToken), conserva el que ya estuviera persistido en
    // vez de pisarlo con null.
    let existingRefreshToken = null;
    try {
      existingRefreshToken = JSON.parse(fs.readFileSync(_path(), "utf8")).refreshToken || null;
    } catch (_err) {
      // sin archivo previo
    }

    fs.writeFileSync(
      _path(),
      JSON.stringify({
        idToken,
        user: user || null,
        refreshToken: refreshToken || existingRefreshToken,
        lastActiveAt: Date.now()
      }),
      "utf8"
    );
  } catch (_err) {
    // no bloquea el login si no se pudo persistir
  }
}

function touchLastActive() {
  try {
    const data = JSON.parse(fs.readFileSync(_path(), "utf8"));
    if (!data || !data.idToken) return;
    data.lastActiveAt = Date.now();
    fs.writeFileSync(_path(), JSON.stringify(data), "utf8");
  } catch (_err) {
    // sin sesión persistida — no hay nada que actualizar
  }
}

function clearPersistedSession() {
  try {
    fs.unlinkSync(_path());
  } catch (_err) {
    // ya no existía
  }
}

// Devuelve { idToken, user, refreshToken } si hay una sesión persistida y
// no pasó el timeout de inactividad, o null (y limpia el archivo) si expiró.
function loadFreshSession() {
  try {
    const data = JSON.parse(fs.readFileSync(_path(), "utf8"));
    if (!data || !data.idToken || !data.lastActiveAt) return null;

    const elapsed = Date.now() - Number(data.lastActiveAt);
    if (elapsed > IDLE_TIMEOUT_MS) {
      clearPersistedSession();
      return null;
    }
    return { idToken: data.idToken, user: data.user || null, refreshToken: data.refreshToken || null };
  } catch (_err) {
    return null;
  }
}

module.exports = {
  persistSession,
  touchLastActive,
  clearPersistedSession,
  loadFreshSession,
};
