const { getOAuthConfig } = require("./oauth-config");
const {
  getFirebaseRefreshToken,
  getFirebaseSessionInfo,
  setFirebaseAuth,
  clearFirebaseAuth,
} = require("../session/runtime-state");

const SECURE_TOKEN_ENDPOINT = "https://securetoken.googleapis.com/v1/token";

// Renueva el idToken de Firebase usando el refreshToken ya guardado (sin
// pedir login) — el único disparador es un 401 real de la API, ver kv-ipc.js.
// Si el refreshToken mismo está vencido/revocado, limpia toda la sesión para
// forzar un re-login la próxima vez que haga falta un token: ese es el único
// caso legítimo de volver a pedirle login al usuario.
async function refreshFirebaseToken() {
  const refreshToken = getFirebaseRefreshToken();
  if (!refreshToken) return false;

  const cfg = getOAuthConfig();
  if (!cfg.firebaseWebApiKey) return false;

  try {
    const res = await fetch(`${SECURE_TOKEN_ENDPOINT}?key=${cfg.firebaseWebApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.id_token) {
      throw new Error(data.error?.message || data.error_description || "refresh_failed");
    }

    // La respuesta usa snake_case (id_token/refresh_token) y no trae email —
    // conserva el user ya guardado.
    const currentUser = getFirebaseSessionInfo().user;
    setFirebaseAuth(data.id_token, currentUser, data.refresh_token);
    return true;
  } catch (_err) {
    clearFirebaseAuth();
    return false;
  }
}

module.exports = { refreshFirebaseToken };
