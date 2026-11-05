// Live MPEGTS stream via mpegts.js.
// mpegts.js remuxes MPEGTS → fMP4 and feeds MSE, so codec support is broad.

const EDGE_LATENCY_S = 1.2;

// Reconnect config — delays cortos para que el usuario vea reconexión rápida
const RECONNECT_DELAYS_MS = [2000, 4000, 6000, 8000];

// Stall detection: if currentTime doesn't advance for STALL_TIMEOUT_MS → reconnect
const STALL_CHECK_INTERVAL_MS = 2000;
const STALL_TIMEOUT_MS = 8000;

// videoEl → session object
const _active = new WeakMap();
// Needed for offline/online iteration (WeakMap is not iterable)
const _activeVideos = new Set();

// ── offline / online handlers ─────────────────────────────────────────────────

window.addEventListener("offline", () => {
  for (const v of _activeVideos) {
    const sess = _active.get(v);
    if (!sess) continue;
    _clearStall(sess);
    if (sess.reconnectTimer) { clearTimeout(sess.reconnectTimer); sess.reconnectTimer = null; }
    _stopPlayerOnly(v, sess);
    v.dataset.streamState = "reconnecting";
    v.dispatchEvent(new CustomEvent("stream:reconnecting", {
      bubbles: true,
      detail: { channel: parseInt(v.dataset.streamChannel, 10), attempt: 0, immediate: true }
    }));
  }
});

window.addEventListener("online", () => {
  for (const v of _activeVideos) {
    const sess = _active.get(v);
    if (!sess || !sess.reconnectParams) continue;
    if (sess.reconnectTimer) { clearTimeout(sess.reconnectTimer); sess.reconnectTimer = null; }
    sess.reconnectAttempt = 0;
    // Small pause to let the network stack stabilize before reconnecting
    sess.reconnectTimer = setTimeout(() => {
      sess.reconnectTimer = null;
      if (!_active.has(v)) return;
      _doReconnect(v, sess);
    }, 800);
  }
});

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Start streaming into videoEl.
 * Returns { ok: true } once the player is wired up (non-blocking).
 *
 * Options:
 *   baseUrl      {string}   SDK base URL
 *   channel      {number}   channel id
 *   token        {string}   Bearer JWT
 *   apiKey       {string?}  x-api-key header value
 *   onReconnect  {async () => { token, apiKey } | null}
 *                Called to obtain fresh credentials before each retry.
 *                Return null / falsy to abort the reconnect loop.
 *   _reconnectAttempt {number} internal — current attempt index (0-based)
 */
export async function startStream(videoEl, {
  baseUrl,
  channel,
  token,
  apiKey = null,
  onReconnect = null,
  _reconnectAttempt = 0,
}) {
  stopStream(videoEl);

  console.log(`[KV][stream] startStream ch=${channel} attempt=${_reconnectAttempt}`);

  if (typeof window.mpegts === "undefined") {
    console.error("[KV][stream] mpegts.js not loaded");
    return _errorState(videoEl, "mpegts_unavailable");
  }

  const url = `${baseUrl}/stream/play/${channel}`;

  const reqHeaders = { Authorization: `Bearer ${token}` };
  if (apiKey) {
    reqHeaders["x-api-key"]     = apiKey;
    reqHeaders["x-sender-type"] = "ui";
    reqHeaders["x-sender-id"]   = "electron-client";
  }

  let player;
  try {
    player = window.mpegts.createPlayer(
      { type: "mpegts", isLive: true, url, withCredentials: false },
      {
        headers:                        reqHeaders,
        enableWorker:                   false,
        liveBufferLatencyChasing:       true,
        liveBufferLatencyMaxLatency:    EDGE_LATENCY_S + 0.5,
        liveBufferLatencyMinRemain:     0.1,
        lazyLoadMaxDuration:            180,
        seekType:                       "range",
        autoCleanupSourceBuffer:        true,
        autoCleanupMaxBackwardDuration: 5,
        autoCleanupMinBackwardDuration: 2,
      }
    );
  } catch (err) {
    console.error("[KV][stream] mpegts.createPlayer failed:", err.message || err);
    return _errorState(videoEl, "player_create_failed");
  }

  player.attachMediaElement(videoEl);

  const session = {
    player,
    reconnectTimer:  null,
    reconnectAttempt: _reconnectAttempt,
    stallInterval:   null,
    stallLastTime:   null,
    stalledMs:       0,
    reconnectParams: { baseUrl, channel, apiKey, onReconnect },
  };
  _active.set(videoEl, session);
  _activeVideos.add(videoEl);

  videoEl.dataset.streamChannel = String(channel);
  videoEl.dataset.streamState   = "connecting";

  player.on(window.mpegts.Events.ERROR, (errType, errDetail, errInfo) => {
    console.error(`[KV][stream] ch=${channel} mpegts error:`, errType, errDetail, errInfo);
    // Reconectar en cualquier tipo de error cuando hay callback disponible.
    // El stream es live — cualquier fallo (red, proxy RTSP, codec) merece reintento.
    if (onReconnect) {
      _clearStall(session);
      _scheduleReconnect(videoEl, { baseUrl, channel, apiKey, onReconnect }, session);
    } else {
      _errorState(videoEl, "stream_error");
    }
  });

  player.on(window.mpegts.Events.MEDIA_INFO, (info) => {
    console.log(`[KV][stream] ch=${channel} media info:`, info);
  });

  player.load();

  const tryPlay = () => {
    videoEl.play().catch((err) => {
      console.warn(`[KV][stream] ch=${channel} play() rejected:`, err.message || err);
    });
  };

  videoEl.addEventListener("canplay", tryPlay, { once: true });

  videoEl.addEventListener("playing", () => {
    videoEl.dataset.streamState = "playing";
    if (_active.has(videoEl)) {
      _active.get(videoEl).reconnectAttempt = 0;
    }
    console.log(`[KV][stream] ch=${channel} playing`);
    // Start stall detector now that video is live
    _startStallDetector(videoEl, session, { baseUrl, channel, apiKey, onReconnect });
  }, { once: true });

  return { ok: true };
}

export function stopStream(videoEl) {
  if (!_active.has(videoEl)) return;
  const session = _active.get(videoEl);

  _clearStall(session);

  if (session.reconnectTimer != null) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }

  _active.delete(videoEl);
  _activeVideos.delete(videoEl);

  try {
    session.player?.pause();
    session.player?.unload();
    session.player?.detachMediaElement();
    session.player?.destroy();
  } catch (_) {}

  videoEl.pause();
  videoEl.removeAttribute("src");
  videoEl.load();
  delete videoEl.dataset.streamState;
  delete videoEl.dataset.streamChannel;
}

export function stopAllStreams(containerEl) {
  if (!containerEl) return;
  for (const v of containerEl.querySelectorAll("video[data-stream-channel]")) {
    stopStream(v);
  }
}

// ── internal ──────────────────────────────────────────────────────────────────

function _errorState(videoEl, error) {
  videoEl.dataset.streamState = "error";
  videoEl.dataset.streamError = error;
  return { ok: false, error };
}

function _clearStall(session) {
  if (session.stallInterval != null) {
    clearInterval(session.stallInterval);
    session.stallInterval = null;
  }
  session.stallLastTime = null;
  session.stalledMs     = 0;
}

/**
 * Poll video.currentTime every STALL_CHECK_INTERVAL_MS.
 * If it doesn't advance for STALL_TIMEOUT_MS → trigger reconnect.
 * Skips ticks when the page is hidden (tab in background).
 */
function _startStallDetector(videoEl, session, reconnectParams) {
  _clearStall(session);
  session.stallLastTime = videoEl.currentTime;

  session.stallInterval = setInterval(() => {
    if (!_active.has(videoEl)) { _clearStall(session); return; }
    if (document.hidden) return; // avoid false positives when tab is hidden
    if (videoEl.dataset.streamState !== "playing") return;

    const cur = videoEl.currentTime;
    if (cur !== session.stallLastTime) {
      session.stallLastTime = cur;
      session.stalledMs     = 0;
    } else {
      session.stalledMs += STALL_CHECK_INTERVAL_MS;
      if (session.stalledMs >= STALL_TIMEOUT_MS) {
        console.warn(`[KV][stream] ch=${reconnectParams.channel} stall detected (${session.stalledMs}ms) → reconnect`);
        _clearStall(session);
        _scheduleReconnect(videoEl, reconnectParams, session);
      }
    }
  }, STALL_CHECK_INTERVAL_MS);
}

/**
 * Schedule a reconnect attempt with exponential backoff.
 */
function _scheduleReconnect(videoEl, { baseUrl, channel, apiKey, onReconnect }, session) {
  if (!onReconnect) {
    _errorState(videoEl, "stream_error");
    return;
  }
  const attempt = session.reconnectAttempt;
  const delayMs = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];

  console.log(`[KV][stream] ch=${channel} scheduling reconnect attempt ${attempt + 1} in ${delayMs}ms`);

  videoEl.dataset.streamState = "reconnecting";
  videoEl.dispatchEvent(new CustomEvent("stream:reconnecting", {
    bubbles: true,
    // Primer fallo: mostrar overlay inmediatamente. Reconexiones posteriores
    // usan delay de 5s para que los drops rápidos sean invisibles.
    detail: { channel, attempt: attempt + 1, immediate: attempt === 0 }
  }));

  _stopPlayerOnly(videoEl, session);

  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    if (!_active.has(videoEl)) return;
    session.reconnectAttempt = Math.min(attempt + 1, RECONNECT_DELAYS_MS.length - 1);
    _doReconnect(videoEl, session);
  }, delayMs);

  _active.set(videoEl, session);
}

async function _doReconnect(videoEl, session) {
  const { baseUrl, channel, apiKey, onReconnect } = session.reconnectParams;
  if (!onReconnect) { _errorState(videoEl, "stream_error"); return; }

  let freshCreds;
  try {
    freshCreds = await onReconnect();
  } catch (err) {
    console.error(`[KV][stream] ch=${channel} onReconnect threw:`, err.message || err);
    freshCreds = null;
  }

  if (!freshCreds || !freshCreds.token) {
    console.warn(`[KV][stream] ch=${channel} no fresh token — retrying in 8s`);
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = null;
      if (!_active.has(videoEl)) return;
      _doReconnect(videoEl, session);
    }, 8_000);
    return;
  }

  console.log(`[KV][stream] ch=${channel} reconnecting with fresh token (attempt ${session.reconnectAttempt})`);

  startStream(videoEl, {
    baseUrl,
    channel,
    token:    freshCreds.token,
    apiKey:   freshCreds.apiKey !== undefined ? freshCreds.apiKey : (freshCreds.api_key || apiKey || null),
    onReconnect,
    _reconnectAttempt: session.reconnectAttempt,
  });
}

function _stopPlayerOnly(videoEl, session) {
  _clearStall(session);
  try {
    session.player?.pause();
    session.player?.unload();
    session.player?.detachMediaElement();
    session.player?.destroy();
  } catch (_) {}
  session.player = null;

  videoEl.pause();
  videoEl.removeAttribute("src");
  videoEl.load();
}
