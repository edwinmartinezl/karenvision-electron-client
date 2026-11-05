const http = require("http");
const crypto = require("crypto");
const { Readable } = require("stream");

const { runtimeState, getFirebaseIdToken } = require("../session/runtime-state");
const { refreshFirebaseToken } = require("../auth/token-refresh");
const { readClientConfig } = require("../config/client-config");

// Servidor local (solo 127.0.0.1, puerto efímero) que hace de proxy
// autenticado entre <video src="..."> y /playback/serve. Antes, cada clip
// se descargaba completo (blob) antes de poder reproducirse — con
// segmentos de ~150MB, saltar de una hora a otra tardaba varios segundos.
// /playback/serve ya soporta Range requests (Starlette FileResponse), así
// que este proxy solo reenvía el header Range + el idToken de Firebase (el
// <video> nativo no puede mandar headers custom), dejando que el navegador
// pida por rangos y arranque a reproducir sin bajar el archivo entero.
//
// El módulo Semantic ([[050]]) tiene el mismo problema exacto con
// /semantic/serve (también exige Firebase auth, también soporta Range) —
// en vez de levantar un segundo servidor efímero, este mismo proxy
// también atiende la ruta /semantic-serve (ver colaboracion/053). El
// nombre del archivo/handlers quedó como "playback" por compatibilidad
// con el resto del cliente (kv:playback:proxy-info, getPlaybackProxyInfo)
// — no es playback-específico en la práctica, es un proxy autenticado
// genérico para los endpoints *serve del SDK.
//
// El token en la URL (?token=...) es solo para que otro proceso local no
// pueda pegarle a este puerto y leer grabaciones sin pasar por la app.

let _server = null;
let _port = null;
let _token = null;
let _startPromise = null;

function _senderHeaders() {
  return { "x-sender-type": "ui", "x-sender-id": "electron-playback-proxy" };
}

function _baseUrl() {
  return (runtimeState.session && runtimeState.session.baseUrl)
    || readClientConfig().base_url
    || "http://127.0.0.1:2030";
}

async function _fetchServe(filePath, rangeHeader, idToken) {
  const url = `${_baseUrl()}/playback/serve?path=${encodeURIComponent(filePath)}`;
  const headers = { authorization: `Bearer ${idToken}`, ..._senderHeaders() };
  if (rangeHeader) headers["range"] = rangeHeader;
  return fetch(url, { headers });
}

async function _fetchSemanticServe(id, rangeHeader, idToken) {
  const url = `${_baseUrl()}/semantic/serve?id=${encodeURIComponent(id)}`;
  const headers = { authorization: `Bearer ${idToken}`, ..._senderHeaders() };
  if (rangeHeader) headers["range"] = rangeHeader;
  return fetch(url, { headers });
}

async function _handleRequest(req, res) {
  try {
    const reqUrl = new URL(req.url, "http://127.0.0.1");
    const isPlayback = reqUrl.pathname === "/serve";
    const isSemantic = reqUrl.pathname === "/semantic-serve";
    if (!isPlayback && !isSemantic) {
      res.writeHead(404).end();
      return;
    }

    if (reqUrl.searchParams.get("token") !== _token) {
      res.writeHead(403).end();
      return;
    }

    const filePath = isPlayback ? reqUrl.searchParams.get("path") : null;
    const semanticId = isSemantic ? reqUrl.searchParams.get("id") : null;
    if (isPlayback && !filePath) {
      res.writeHead(400).end();
      return;
    }
    if (isSemantic && !semanticId) {
      res.writeHead(400).end();
      return;
    }

    const idToken = getFirebaseIdToken();
    if (!idToken) {
      res.writeHead(401).end();
      return;
    }

    const rangeHeader = req.headers["range"];
    const fetchServe = (token) => isPlayback
      ? _fetchServe(filePath, rangeHeader, token)
      : _fetchSemanticServe(semanticId, rangeHeader, token);

    let upstream = await fetchServe(idToken);
    if (upstream.status === 401) {
      const refreshed = await refreshFirebaseToken();
      if (refreshed) {
        upstream = await fetchServe(getFirebaseIdToken());
      }
    }

    if (!upstream.ok) {
      res.writeHead(upstream.status).end();
      return;
    }

    const headers = {};
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(key);
      if (value) headers[key] = value;
    }
    res.writeHead(upstream.status, headers);

    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (_err) {
    try { res.writeHead(500).end(); } catch (_e) { /* ya se había cerrado */ }
  }
}

function _start() {
  return new Promise((resolve) => {
    _token = crypto.randomBytes(16).toString("hex");
    _server = http.createServer(_handleRequest);
    _server.listen(0, "127.0.0.1", () => {
      _port = _server.address().port;
      resolve({ port: _port, token: _token });
    });
  });
}

// Idempotente — el bootstrap la dispara temprano, y el handler IPC la espera
// también por si el renderer pregunta antes de que el server haya arrancado.
function ensurePlaybackProxy() {
  if (!_startPromise) _startPromise = _start();
  return _startPromise;
}

module.exports = { ensurePlaybackProxy };
