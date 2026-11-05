const { shell } = require("electron");
const http = require("http");
const crypto = require("crypto");
const { getOAuthConfig } = require("./oauth-config");

// OAuth 2.0 "Desktop app" client (loopback redirect, RFC 8252) + Firebase
// Identity Toolkit REST API. No depende del SDK de Firebase en el navegador
// ni de storage compartido entre ventanas/dominios (eso es lo que fallaba
// con signInWithPopup/signInWithRedirect: auth/internal-error tanto en
// Brave como en Firefox).
// Credenciales en oauth-config.js (userData/env) — nunca en el repo.

const GOOGLE_AUTH_ENDPOINT  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const TIMEOUT_MS = 3 * 60 * 1000; // 3 min para completar el login en el navegador

function _b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function _pkcePair() {
  const verifier = _b64url(crypto.randomBytes(32));
  const challenge = _b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function _htmlPage(message) {
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8">
<title>KarenVision — Iniciar con Google</title>
<style>
  html,body{margin:0;height:100%;background:#0f1420;color:rgba(255,255,255,0.7);
  font:13px -apple-system,"Segoe UI",Roboto,sans-serif;display:flex;
  align-items:center;justify-content:center;text-align:center}
</style></head><body><div>${message}</div></body></html>`;
}

async function _exchangeCodeForGoogleTokens(cfg, code, redirectUri, codeVerifier) {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "google_token_exchange_failed");
  return data; // { id_token, access_token, ... }
}

async function _exchangeGoogleIdTokenForFirebase(cfg, googleIdToken) {
  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${cfg.firebaseWebApiKey}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: "http://localhost",
      returnSecureToken: true,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "firebase_signin_idp_failed");
  return data; // { idToken, refreshToken, localId, email, ... }
}

// Devuelve una promesa que resuelve con { ok: true, idToken, refreshToken, user }
// o { ok: false, error }.
function runGoogleLogin() {
  return new Promise((resolve) => {
    const cfg = getOAuthConfig();
    if (!cfg.clientId || !cfg.clientSecret || !cfg.firebaseWebApiKey) {
      resolve({ ok: false, error: "oauth_not_configured" });
      return;
    }

    let settled = false;
    let timer = null;
    const state = crypto.randomBytes(16).toString("hex");
    const { verifier, challenge } = _pkcePair();

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(payload || { ok: false, error: "empty_result" });
      server.close();
    };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/") {
        res.writeHead(404);
        res.end();
        return;
      }

      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");

      if (oauthError) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(_htmlPage(`Error: ${oauthError}. Podés cerrar esta pestaña.`));
        finish({ ok: false, error: oauthError });
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(_htmlPage("Solicitud inválida. Podés cerrar esta pestaña."));
        return;
      }

      try {
        const redirectUri = `http://127.0.0.1:${server.address().port}/`;
        const googleTokens = await _exchangeCodeForGoogleTokens(cfg, code, redirectUri, verifier);
        const fbResult = await _exchangeGoogleIdTokenForFirebase(cfg, googleTokens.id_token);

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(_htmlPage("Listo. Ya podés cerrar esta pestaña y volver a KarenVision."));

        finish({
          ok: true,
          idToken: fbResult.idToken,
          refreshToken: fbResult.refreshToken,
          user: { email: fbResult.email, uid: fbResult.localId, name: fbResult.displayName || null },
        });
      } catch (err) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(_htmlPage(`Error: ${err.message}. Podés cerrar esta pestaña.`));
        finish({ ok: false, error: "google_login_failed", detail: err.message });
      }
    });

    server.on("error", (err) => finish({ ok: false, error: "local_server_error", detail: String(err && err.message ? err.message : err) }));

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/`;
      const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
      authUrl.searchParams.set("client_id", cfg.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "openid email profile");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("access_type", "online");
      authUrl.searchParams.set("prompt", "select_account");

      shell.openExternal(authUrl.toString());
      timer = setTimeout(() => finish({ ok: false, error: "timeout" }), TIMEOUT_MS);
    });
  });
}

module.exports = { runGoogleLogin };
