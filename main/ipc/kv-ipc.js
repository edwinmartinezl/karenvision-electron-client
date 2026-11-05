const { ipcMain, dialog, BrowserWindow } = require("electron");
const fs   = require("fs");
const path = require("path");

const {
  normalizeBaseUrl,
  generateInstanceId,
  readClientConfig,
  writeClientConfig
} = require("../config/client-config");
const { readI18nCache, writeI18nCache } = require("../config/i18n-cache");
const {
  runtimeState,
  clearRuntimeSession,
  setRuntimeSession,
  getWindowStats,
  getSessionInfoPayload,
  setFirebaseAuth,
  clearFirebaseAuth,
  getFirebaseIdToken,
  getFirebaseSessionInfo,
  restoreFirebaseAuthIfFresh
} = require("../session/runtime-state");
const { apiRequest, callViewApi } = require("../api/api-client");
const { createViewerWindow, createDetachedWindow, isDetachedWindowOpen } = require("../windows/viewer-window");
const { viewerWindows } = require("../windows/window-state");
const { runGoogleLogin } = require("../auth/google-login-window");
const { refreshFirebaseToken } = require("../auth/token-refresh");
const { ensurePlaybackProxy } = require("../playback/playback-proxy");
const { scheduleCodeSessionRefresh, stopCodeSessionRefresh } = require("../session/code-session-refresh");
const { checkInternet } = require("../net/connectivity");

const IS_UI_ONLY = process.env.KV_DEV_UI_ONLY === "1";

// Resolve the API key for SDK requests.
// Priority: provisioned key in config.json → KV_API_KEY env → keys file (dev fallback).
function _resolveApiKey() {
  const cfg = readClientConfig();
  if (cfg.api_key) return cfg.api_key;

  const envKey = String(process.env.KV_API_KEY || "").trim();
  if (envKey) return envKey;

  const sdkRoot = String(process.env.KV_SDK_ROOT || "").trim() || "/opt/karenvision_sdk";
  const keysPath = path.join(sdkRoot, "karenvision", "api", "keys", "api_keys.json");
  try {
    const data = JSON.parse(fs.readFileSync(keysPath, "utf8"));
    const keys = Array.isArray(data && data.keys) ? data.keys : [];
    const active = keys.find((k) => k.active && k.key);
    return active ? String(active.key) : null;
  } catch (_) {
    return null;
  }
}

// Resolve the elevation PIN for sensitive operations (storage path, restore, etc).
// Priority: client config → KV_ELEVATION_CODE env.
function _resolveElevationCode() {
  const cfg = readClientConfig();
  if (cfg.elevation_code) return String(cfg.elevation_code).trim();
  const envCode = String(process.env.KV_ELEVATION_CODE || "").trim();
  return envCode || null;
}

// Returns the client_instance_id, generating and persisting one if missing.
function _resolveInstanceId() {
  const cfg = readClientConfig();
  if (cfg.client_instance_id) return cfg.client_instance_id;
  const id = generateInstanceId();
  writeClientConfig({ client_instance_id: id });
  return id;
}

// Build the standard sender headers for every SDK request.
function _senderHeaders() {
  return {
    "x-sender-type": "ui",
    "x-sender-id":   _resolveInstanceId(),
  };
}

// makeRequest(idToken) arma y ejecuta una request que devuelve { status, ... }.
// Si la respuesta es 401 (idToken vencido), intenta refreshFirebaseToken()
// una sola vez y reintenta con el token nuevo. Si el refresh también falla
// (refreshToken revocado/vencido), propaga el 401 original tal cual — el
// frontend ya lo maneja (reconexión visual, toasts) sin cambios ahí. Ese es
// el único caso legítimo de terminar pidiéndole login de nuevo al usuario.
async function _requestWithTokenRefresh(makeRequest) {
  let result = await makeRequest(getFirebaseIdToken());
  if (result.status === 401) {
    const refreshed = await refreshFirebaseToken();
    if (refreshed) {
      result = await makeRequest(getFirebaseIdToken());
    }
  }
  return result;
}

function createUiOnlyMockLoginBody() {
  return {
    ok: true,
    session_token: "dev-session",
    expires_in: 3600,
    client: {
      label: "DEV CLIENT",
      max_groups: 25,
      max_windows: 4
    }
  };
}

function registerKvIpcHandlers() {
  ipcMain.handle("kv:config:get", async () => {
    return { ok: true, ...readClientConfig() };
  });

  ipcMain.handle("kv:config:set", async (_event, payload) => {
    try {
      const normalized = normalizeBaseUrl(payload && payload.base_url);
      writeClientConfig(normalized);
      if (runtimeState.session && runtimeState.session.baseUrl !== normalized) {
        clearRuntimeSession();
      }
      return { ok: true, base_url: normalized };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("kv:view:session-info", async () => {
    return getSessionInfoPayload();
  });

  ipcMain.handle("kv:i18n:read-cache", async (_event, payload) => {
    const cached = readI18nCache(payload && payload.locale);
    return cached ? { ok: true, ...cached } : { ok: false };
  });

  ipcMain.handle("kv:i18n:write-cache", async (_event, payload) => {
    const ok = writeI18nCache(payload && payload.locale, (payload && payload.translations) || {});
    return { ok };
  });

  // Auto-discover SDK on localhost by probing common ports from the main process
  // (renderer CSP blocks direct fetch to ports not in connect-src).
  ipcMain.handle("kv:client:autodiscover", async () => {
    const cfg = readClientConfig();
    if (cfg.api_key && cfg.base_url) {
      return { ok: true, found: true, base_url: cfg.base_url, api_key: cfg.api_key, already_provisioned: true };
    }

    const CANDIDATES = [
      cfg.base_url,
      "http://127.0.0.1:2130",
      "http://127.0.0.1:2030",
      "http://127.0.0.1:2040",
      "http://127.0.0.1:2050",
    ].filter(Boolean);

    for (const candidate of CANDIDATES) {
      try {
        const normalizedUrl = normalizeBaseUrl(candidate);
        const healthResult = await apiRequest({ baseUrl: normalizedUrl, method: "GET", pathName: "/health" });
        if (!healthResult.okHttp) continue;
        const svc = healthResult.data && healthResult.data.service;
        if (svc && !String(svc).toLowerCase().includes("karen")) continue;

        // SDK found — provision
        const provResult = await apiRequest({ baseUrl: normalizedUrl, method: "POST", pathName: "/client/provision", body: {} });
        if (!provResult.okHttp || !provResult.data || !provResult.data.ok) continue;

        const { api_key } = provResult.data;
        const instanceId = cfg.client_instance_id || generateInstanceId();
        writeClientConfig({ base_url: normalizedUrl, api_key, client_instance_id: instanceId, connected_at: new Date().toISOString() });

        return { ok: true, found: true, base_url: normalizedUrl, api_key, client_instance_id: instanceId };
      } catch (_) {}
    }

    return { ok: false, found: false };
  });

  // Provision: obtain (or create) the Electron API key from the SDK.
  // Called automatically on first run or when api_key is missing from config.
  ipcMain.handle("kv:client:provision", async (_event, payload) => {
    try {
      const baseUrlRaw = (payload && payload.base_url) || readClientConfig().base_url || "http://127.0.0.1:2030";
      const baseUrl = normalizeBaseUrl(baseUrlRaw);

      const result = await apiRequest({
        baseUrl,
        method: "POST",
        pathName: "/client/provision",
        body: {},
      });

      if (!result.okHttp || !result.data || !result.data.ok) {
        return { ok: false, error: result.data?.error || "provision_failed", status: result.status };
      }

      const { api_key } = result.data;
      const cfg = readClientConfig();
      const instanceId = cfg.client_instance_id || generateInstanceId();

      writeClientConfig({
        base_url: baseUrl,
        api_key,
        client_instance_id: instanceId,
        connected_at: new Date().toISOString(),
      });

      return { ok: true, api_key, client_instance_id: instanceId, base_url: baseUrl };
    } catch (err) {
      return { ok: false, error: "network_error", detail: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("kv:view:login", async (_event, payload) => {
    try {
      const code = String((payload && payload.code) || "").trim();
      if (IS_UI_ONLY) {
        console.log("[KV][ui-only] handler=kv:view:login enabled");
        let effectiveBaseUrl = "http://127.0.0.1:2030";
        if (payload && payload.base_url) {
          try {
            effectiveBaseUrl = normalizeBaseUrl(payload.base_url);
          } catch (_err) {
            effectiveBaseUrl = "http://127.0.0.1:2030";
          }
        }
        writeClientConfig(effectiveBaseUrl);
        const mockBody = createUiOnlyMockLoginBody();
        setRuntimeSession(effectiveBaseUrl, mockBody);
        return {
          status: 200,
          base_url: effectiveBaseUrl,
          ok: true,
          session_token: mockBody.session_token,
          expires_in: mockBody.expires_in,
          client: mockBody.client,
          current_windows: viewerWindows.size,
          max_windows: 4
        };
      }

      const baseUrl = normalizeBaseUrl(payload && payload.base_url);
      const effectiveBaseUrl = baseUrl;
      writeClientConfig(effectiveBaseUrl);

      const result = await apiRequest({
        baseUrl: effectiveBaseUrl,
        method: "POST",
        pathName: "/view/login",
        body: { code }
      });

      const body = result.data && typeof result.data === "object" ? result.data : {};
      if (!result.okHttp || !body.ok) {
        clearRuntimeSession();
        return {
          status: result.status,
          ok: false,
          error: body.error || "login_failed"
        };
      }

      setRuntimeSession(effectiveBaseUrl, body, { code });
      // Login manual sin usuario (código de 6 dígitos, ver colaboracion/054)
      // — se renueva solo en segundo plano para no tener que reingresar el
      // código cada 10 min mientras la app siga corriendo.
      scheduleCodeSessionRefresh(body.expires_in);
      return {
        status: result.status,
        base_url: effectiveBaseUrl,
        ...body,
        ...getWindowStats()
      };
    } catch (err) {
      return {
        ok: false,
        error: "network_error",
        detail: String(err && err.message ? err.message : err),
        status: 0
      };
    }
  });

  // Login real con Google vía OAuth 2.0 loopback directo (ver main/auth/,
  // colaboracion/020). El backend valida el idToken de Firebase resultante
  // contra los certificados públicos de Google
  // (karenvision/api/core/firebase_auth.py) — sin token no hay ninguna
  // request autenticada posible.
  ipcMain.handle("kv:auth:google-login", async () => {
    const result = await runGoogleLogin();
    if (result?.ok && result.idToken) {
      setFirebaseAuth(result.idToken, result.user, result.refreshToken);
    }
    return result;
  });

  ipcMain.handle("kv:auth:session-info", async () => {
    return { ok: true, ...getFirebaseSessionInfo() };
  });

  // Llamado al arrancar la app (antes de mostrar login) — si hay una sesión
  // de Google persistida y no pasó el timeout de inactividad (30 min desde
  // el último cierre), la restaura y evita pedir login de nuevo.
  ipcMain.handle("kv:auth:try-restore-session", async () => {
    const user = restoreFirebaseAuthIfFresh();
    return { ok: true, restored: Boolean(user), user };
  });

  ipcMain.handle("kv:view:logout", async () => {
    stopCodeSessionRefresh();
    clearRuntimeSession();
    clearFirebaseAuth();
    return { ok: true };
  });

  // Chequeo de conectividad real a internet (no al SDK local, que responde
  // igual con o sin internet) — usado por login-panel.js para decidir si
  // ofrece "Continuar con Google" o el login manual por código. Ver
  // main/net/connectivity.js y colaboracion/054.
  ipcMain.handle("kv:net:check-internet", async () => {
    const online = await checkInternet();
    return { ok: true, online };
  });

  ipcMain.handle("kv:dialog:pick-folder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Seleccionar carpeta de grabación",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Seleccionar carpeta",
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });

  // Ruta de destino para exportar un clip — el usuario elige el archivo
  // exacto (no solo la carpeta), ver colaboracion/035.
  ipcMain.handle("kv:dialog:pick-save-file", async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const defaultName = String((payload && payload.defaultName) || "export.mp4");
    const result = await dialog.showSaveDialog(win, {
      title: "Exportar grabación",
      defaultPath: defaultName,
      buttonLabel: "Exportar",
      filters: [{ name: "Video MP4", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle("kv:view:groups", async () => {
    const response = await callViewApi("/view/groups");
    return {
      ...response,
      ...getWindowStats()
    };
  });

  ipcMain.handle("kv:client:state", async () => {
    if (IS_UI_ONLY) {
      console.log("[KV][ui-only] handler=kv:client:state enabled");
      if (!runtimeState.session) {
        const cfg = readClientConfig();
        const baseUrl = (cfg && typeof cfg.base_url === "string" && cfg.base_url.trim())
          ? cfg.base_url.trim()
          : "http://127.0.0.1:2030";
        setRuntimeSession(baseUrl, createUiOnlyMockLoginBody());
      }
      return {
        status: 200,
        ok: true,
        client: {
          label: "DEV CLIENT",
          rev: 1
        },
        modules: [
          { id: "view", title: "View", enabled: true }
        ],
        current_windows: viewerWindows.size,
        max_windows: 4
      };
    }

    const response = await callViewApi("/client/state");
    if (response.ok && runtimeState.session && response.client && typeof response.client === "object") {
      runtimeState.session.client = {
        ...(runtimeState.session.client || {}),
        ...response.client
      };
    }
    return {
      ...response,
      ...getWindowStats()
    };
  });

  ipcMain.handle("kv:view:state", async (_event, payload) => {
    const group = String((payload && payload.group) || "").trim();
    const response = await callViewApi("/view/state", { query: { group } });
    return {
      ...response,
      ...getWindowStats()
    };
  });

  ipcMain.handle("kv:stream:token", async (_event, payload) => {
    const channel = Number(payload && payload.channel);
    const group   = String((payload && payload.group) || "").trim();

    if (!Number.isFinite(channel) || channel < 1) {
      return { ok: false, error: "invalid_channel" };
    }
    if (!group) {
      return { ok: false, error: "group_required" };
    }

    const baseUrl = (runtimeState.session && runtimeState.session.baseUrl)
      || readClientConfig().base_url
      || "http://127.0.0.1:2030";

    // El endpoint /stream/play/{channel} ya no exige x-api-key (ver
    // karenvision/api/routers/stream.py) — solo el JWT de stream que viaja
    // como Authorization: Bearer. api_key queda como campo informativo.
    const apiKey = _resolveApiKey() || null;
    const idToken = getFirebaseIdToken();

    // Path A: view session active → /view/state (original flow)
    if (!IS_UI_ONLY && runtimeState.session && runtimeState.session.sessionToken) {
      const response = await callViewApi("/view/state", { query: { group } });
      if (response.ok) {
        const streams = Array.isArray(response.contract && response.contract.streams)
          ? response.contract.streams : [];
        const entry = streams.find((s) => Number(s.channel) === channel);
        if (entry) {
          return {
            ok:         true,
            channel:    Number(entry.channel),
            token:      String(entry.token),
            expires_in: Number(entry.expires_in || 60),
            play_url:   `${baseUrl}/stream/play/${channel}`,
            api_key:    apiKey
          };
        }
      }
    }

    // Path B: no session → POST /play/live/ui, requiere login con Google.
    if (!idToken) {
      console.error("[KV][stream:token] no Firebase ID token — falta login");
      return { ok: false, error: "not_logged_in" };
    }

    console.log(`[KV][stream:token] path B — baseUrl=${baseUrl} group=${group} ch=${channel}`);
    const result = await _requestWithTokenRefresh((token) => apiRequest({
      baseUrl,
      method: "POST",
      pathName: "/play/live/ui",
      headers: {
        authorization: `Bearer ${token}`,
        ..._senderHeaders()
      },
      body: { group }
    }));

    console.log(`[KV][stream:token] play/live/ui status=${result.status} ok=${result.okHttp}`);
    if (!result.okHttp) {
      console.error("[KV][stream:token] play_live_ui_failed:", result.data);
      return { ok: false, error: "play_live_ui_failed", status: result.status };
    }

    const contract = result.data || {};
    const streams  = Array.isArray(contract.streams) ? contract.streams : [];
    const entry    = streams.find((s) => Number(s.channel) === channel);

    if (!entry) {
      return { ok: false, error: "channel_not_in_contract" };
    }

    return {
      ok:         true,
      channel:    Number(entry.channel),
      token:      String(entry.token),
      expires_in: Number(entry.expires_in || 60),
      play_url:   `${baseUrl}/stream/play/${channel}`,
      api_key:    apiKey
    };
  });

  // Info del proxy local de Playback (ver main/playback/playback-proxy.js) —
  // <video src="http://127.0.0.1:<port>/serve?path=...&token=..."> pega
  // directo ahí, que reenvía a /playback/serve con el idToken de Firebase y
  // soporta Range requests, así el navegador puede pedir por partes en vez
  // de bajar el segmento entero (~150MB) antes de poder reproducir.
  ipcMain.handle("kv:playback:proxy-info", async () => {
    return ensurePlaybackProxy();
  });

  // Generic SDK API request using the admin API key — used by Commands module
  ipcMain.handle("kv:api:request", async (_event, payload) => {
    const method   = String((payload && payload.method) || "GET").toUpperCase();
    const pathName = String((payload && payload.path)   || "/version");
    const body     = (payload && typeof payload.body === "object") ? payload.body : undefined;
    const query    = (payload && typeof payload.query === "object") ? payload.query : undefined;
    // Algunos endpoints son sincronicos/bloqueantes del lado del servidor
    // (ffmpeg real en /semantic/extract, llamada real a Gemini en
    // /semantic/analyze) y tardan mas que el timeout default de 8s — el
    // caller (renderer) pasa timeoutMs explicito para esos casos
    // (colaboracion/071). undefined deja el default de apiRequest().
    const timeoutMs = (payload && Number.isFinite(payload.timeoutMs)) ? payload.timeoutMs : undefined;

    const baseUrl = (runtimeState.session && runtimeState.session.baseUrl)
      || readClientConfig().base_url
      || "http://127.0.0.1:2030";

    const elevationCode = _resolveElevationCode();
    const idToken = getFirebaseIdToken();

    if (!idToken) {
      // Sin login de Google: si hay una sesion activa por codigo, se usa
      // como credencial equivalente — ambos logins dan el mismo acceso
      // (ver karenvision/api/core/firebase_auth.py, colaboracion/071).
      const sessionToken = runtimeState.session && runtimeState.session.sessionToken;
      if (!sessionToken) return { ok: false, error: "not_logged_in" };

      const result = await apiRequest({
        baseUrl, method, pathName, body, query, timeoutMs,
        headers: {
          "x-view-session": sessionToken,
          ..._senderHeaders(),
          ...(elevationCode ? { "x-kv-secret-code": elevationCode } : {})
        }
      });
      return { ok: result.okHttp, status: result.status, data: result.data };
    }

    const result = await _requestWithTokenRefresh((token) => apiRequest({
      baseUrl, method, pathName, body, query, timeoutMs,
      headers: {
        authorization: `Bearer ${token}`,
        ..._senderHeaders(),
        ...(elevationCode ? { "x-kv-secret-code": elevationCode } : {})
      }
    }));

    return { ok: result.okHttp, status: result.status, data: result.data };
  });

  ipcMain.handle("kv:view:duplicate-window", async (_event, payload) => {
    if (!runtimeState.session?.client) {
      return { ok: false, error: "not_logged_in", ...getWindowStats() };
    }
    const maxWindows = Number(runtimeState.session.client.max_windows || 0);
    const currentWindows = viewerWindows.size;
    if (!Number.isFinite(maxWindows) || maxWindows <= 0) {
      return { ok: false, error: "invalid_max_windows", ...getWindowStats() };
    }
    if (currentWindows >= maxWindows) {
      return { ok: false, error: "max_windows_reached", ...getWindowStats() };
    }
    const initialGroup = String((payload && payload.initialGroup) || "").trim().toLowerCase() || null;
    createViewerWindow({ useSplash: false, initialGroup });
    return { ok: true, ...getWindowStats() };
  });

  ipcMain.handle("kv:view:detach-window", async (_event, payload) => {
    const initialGroup = String((payload && payload.initialGroup) || "").trim().toLowerCase() || null;
    const result = createDetachedWindow({ initialGroup });
    return { ok: true, action: result.action, ...getWindowStats() };
  });

  ipcMain.handle("kv:view:detach-status", async () => {
    return { ok: true, isOpen: isDetachedWindowOpen() };
  });
}

module.exports = {
  registerKvIpcHandlers
};
