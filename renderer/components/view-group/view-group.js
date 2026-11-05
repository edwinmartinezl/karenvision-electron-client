import { startStream, stopStream, stopAllStreams } from "../../services/stream-service.js";

const LAYOUT_ORDER = ["1x1", "2x2", "3x3", "4x4"];
const LAYOUT_SLOT_COUNT = {
  "1x1": 1,
  "2x2": 4,
  "3x3": 9,
  "4x4": 16
};
const CORNER_CLASSES_2X2 = ["corner-blue", "corner-red", "corner-red", "corner-blue"];

function normalizeLayout(layoutValue) {
  return LAYOUT_ORDER.includes(layoutValue) ? layoutValue : "2x2";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class ViewGroup {
  constructor(mountEl, groupData = {}, deps = {}) {
    this.mountEl = mountEl || null;
    this.groupData = {
      name: String(groupData?.name || "Grupo"),
      layout: String(groupData?.layout || "2x2"),
      cameras: Array.isArray(groupData?.cameras) ? groupData.cameras : []
    };
    // deps.getStreamToken(channel) → Promise<{ ok, token, play_url, ... }>
    // deps.baseUrl → SDK base URL
    // deps.onDetach() → opens a detached floating window for this group
    // deps.isDetached → true when this ViewGroup is already in a detached window
    // deps.onAuthExpired() → llamado UNA vez cuando getStreamToken confirma que
    // no hay sesión válida (idToken+refreshToken vencidos/revocados) — sin esto
    // el grid queda reintentando "Reconectando" para siempre y en silencio.
    this.deps = {
      getStreamToken: typeof deps.getStreamToken === "function" ? deps.getStreamToken : null,
      baseUrl: String(deps.baseUrl || "http://127.0.0.1:2030"),
      onDetach: typeof deps.onDetach === "function" ? deps.onDetach : null,
      isDetached: Boolean(deps.isDetached),
      onAuthExpired: typeof deps.onAuthExpired === "function" ? deps.onAuthExpired : null,
    };
    this._authExpiredNotified = false;

    this.currentLayout = normalizeLayout(this.groupData.layout);
    this.rootEl = null;
    this.gridEl = null;
    this.gridInnerEl = null;
    this.duplicateBtn = null;
    this.layoutBtn = null;

    this.pendingAnimationCleanupIds = new Set();

    this.onDuplicateClick = this.onDuplicateClick.bind(this);
    this.onLayoutButtonClick = this.onLayoutButtonClick.bind(this);
    this.onLayoutButtonKeyDown = this.onLayoutButtonKeyDown.bind(this);
  }

  mount() {
    if (!this.mountEl) {
      return;
    }
    this._watchdogs   = new Map(); // channelInt → watchdog timerId
    this._retryTimers = new Map(); // channelInt → _scheduleInitialRetry timerId

    const container = document.createElement("div");
    container.className = "view-group";

    container.innerHTML = `
      <div class="group-header">
        <div class="group-title">${escapeHtml(this.groupData.name)}</div>
        <div class="group-actions">
          ${this.deps.isDetached ? "" : `<button class="group-action-btn group-action-duplicate" title="Desacoplar vista" aria-label="Desacoplar vista">⊡</button>`}
          <button
            class="group-action-btn view-toolbar-btn group-action-layout"
            type="button"
            title="Cambiar diseño"
            aria-label="Cambiar diseño"
          ></button>
        </div>
      </div>
      <div class="group-grid">
        <div class="group-grid-inner"></div>
      </div>
    `;

    this.mountEl.appendChild(container);
    this.rootEl = container;
    this.gridEl = container.querySelector(".group-grid");
    this.gridInnerEl = container.querySelector(".group-grid-inner");
    this.duplicateBtn = this.deps.isDetached ? null : container.querySelector(".group-action-duplicate");
    this.layoutBtn = container.querySelector(".group-action-layout");

    this.duplicateBtn?.addEventListener("click", this.onDuplicateClick);
    this.layoutBtn?.addEventListener("click", this.onLayoutButtonClick);
    this.layoutBtn?.addEventListener("keydown", this.onLayoutButtonKeyDown);

    this.renderLayoutButtonIcon();
    this.renderGrid({ animate: false });

    // ResizeObserver: whenever the grid container changes size (including
    // during animated transitions), stamp the exact pixel height onto the
    // inner grid so that grid-template-rows fr-tracks resolve correctly.
    this._ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !this.gridInnerEl) return;
      const { width: W, height: H } = entry.contentRect;
      if (W <= 0 || H <= 0) return;
      this._fitGridToAspect(W, H);
    });
    this._ro.observe(this.gridEl);

    // Live clock — updates every second, shared for all tiles in this grid
    this._tickClock();
    this._clockInterval = setInterval(() => this._tickClock(), 1000);

    console.log("ViewGroup mounted");
  }

  async onDuplicateClick() {
    if (typeof this.deps.onDetach !== "function") return;
    const result = await this.deps.onDetach();
    this._setDetachBtnState(result && result.action === "opened");
  }

  _setDetachBtnState(isOpen) {
    if (!this.duplicateBtn) return;
    const label = isOpen ? "Acoplar vista" : "Desacoplar vista";
    this.duplicateBtn.title = label;
    this.duplicateBtn.setAttribute("aria-label", label);
    this.duplicateBtn.textContent = isOpen ? "⊞" : "⊡";
  }

  onLayoutButtonClick(event) {
    event.preventDefault();
    this.cycleLayout();
  }

  onLayoutButtonKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    this.cycleLayout();
  }

  cycleLayout() {
    const currentIndex = LAYOUT_ORDER.indexOf(this.currentLayout);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % LAYOUT_ORDER.length : 1;
    this.setCurrentLayout(LAYOUT_ORDER[nextIndex]);
  }

  setCurrentLayout(layoutValue) {
    const nextLayout = normalizeLayout(layoutValue);
    if (nextLayout === this.currentLayout) {
      return;
    }
    this.currentLayout = nextLayout;
    this.renderLayoutButtonIcon();
    this.renderGrid({ animate: true });
  }

  renderLayoutButtonIcon() {
    if (!this.layoutBtn) {
      return;
    }
    const dimension = Number.parseInt(this.currentLayout, 10);
    const safeDimension = Number.isFinite(dimension) && dimension >= 1 ? dimension : 2;
    const cellCount = safeDimension * safeDimension;
    const cellsMarkup = Array.from({ length: cellCount }, () => '<div class="layout-icon-cell"></div>').join("");

    this.layoutBtn.innerHTML = `
      <span class="layout-icon layout-${this.currentLayout}" aria-hidden="true">
        ${cellsMarkup}
      </span>
    `;
  }

  getSlotCount() {
    return LAYOUT_SLOT_COUNT[this.currentLayout] || LAYOUT_SLOT_COUNT["2x2"];
  }

  buildTileModels() {
    const slotCount = this.getSlotCount();
    const models = [];

    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const cam = this.groupData.cameras[slotIndex] || null;
      const hasCamera = Boolean(cam);
      const statusClass = String(cam?.status || "offline").toLowerCase() === "online" ? "online" : "offline";
      const cornerClass = this.currentLayout === "2x2" ? (CORNER_CLASSES_2X2[slotIndex] || "") : "";

      models.push({
        key: `slot-${slotIndex + 1}`,
        hasCamera,
        channel: hasCamera ? String(cam?.id || "-") : "",
        name: hasCamera ? String(cam?.name || "Cámara") : "",
        statusClass,
        cornerClass
      });
    }

    return models;
  }

  getGridInnerClassName() {
    return `group-grid-inner layout-${this.currentLayout}`;
  }

  renderGrid({ animate = true } = {}) {
    if (!this.gridInnerEl || !this.gridEl) {
      return;
    }

    const beforeTiles = animate
      ? Array.from(this.gridInnerEl.querySelectorAll(".camera-cell"))
      : [];
    const beforeRects = new Map();
    const removedTileClones = [];
    let gridRect = null;

    if (animate && beforeTiles.length > 0) {
      gridRect = this.gridEl.getBoundingClientRect();
      for (const tile of beforeTiles) {
        const key = tile.getAttribute("data-tile-key");
        if (!key) {
          continue;
        }
        beforeRects.set(key, tile.getBoundingClientRect());
      }
    }

    const tileModels = this.buildTileModels();
    const nextKeys = new Set(tileModels.map((tile) => tile.key));

    if (animate && gridRect) {
      for (const tile of beforeTiles) {
        const key = tile.getAttribute("data-tile-key");
        if (!key || nextKeys.has(key)) {
          continue;
        }
        removedTileClones.push({
          key,
          rect: tile.getBoundingClientRect(),
          clone: tile.cloneNode(true)
        });
      }
    }

    this.gridInnerEl.className = this.getGridInnerClassName();
    this.gridInnerEl.innerHTML = tileModels.map((tileModel) => this.renderTileMarkup(tileModel)).join("");

    // Start MSE streams for camera cells (async, non-blocking)
    this._attachCameraStreams();
    this._bindCellDblClick();

    if (!animate) {
      return;
    }

    if (removedTileClones.length > 0 && gridRect) {
      this.spawnLeavingTileClones(removedTileClones, gridRect);
    }

    this.runGridFlip(beforeRects);
  }

  renderTileMarkup(tile) {
    const cellClassName = [
      "camera-cell",
      "tile",
      tile.hasCamera ? "" : "is-placeholder"
    ].filter(Boolean).join(" ");
    const previewClassName = [
      "camera-preview",
      tile.cornerClass
    ].filter(Boolean).join(" ");
    const cornerIndicator = tile.cornerClass
      ? '<div class="camera-corner-indicator" aria-hidden="true"></div>'
      : "";

    if (!tile.hasCamera) {
      return `
        <div class="${cellClassName}" data-tile-key="${tile.key}" data-tile-id="${tile.key}">
          <div class="${previewClassName}" aria-hidden="true">
            ${cornerIndicator}
          </div>
        </div>
      `;
    }

    // Camera tile: video element fills the preview, overlay floats above
    const channelInt = parseInt(tile.channel, 10);
    const videoAttr  = Number.isFinite(channelInt) && channelInt > 0
      ? `data-stream-channel="${channelInt}"`
      : "";

    return `
      <div class="${cellClassName}" data-tile-key="${tile.key}" data-tile-id="${tile.key}">
        <div class="${previewClassName}" aria-hidden="true">
          <video
            class="camera-video"
            autoplay
            muted
            playsinline
            ${videoAttr}
          ></video>
          <div class="camera-stream-status" data-stream-status-for="${channelInt}">
            <span class="stream-status-dot"></span>
            <span class="stream-status-label">Conectando…</span>
          </div>
          <div class="camera-timestamp" data-timestamp></div>
          ${cornerIndicator}
          <div class="camera-overlay">
            <span class="camera-dot ${tile.statusClass}"></span>
            <span class="camera-channel">${escapeHtml(tile.channel)}</span>
            <span class="camera-name">${escapeHtml(tile.name)}</span>
          </div>
          <div class="camera-reconnecting-overlay" data-reconnect-overlay-for="${channelInt}" hidden>
            <div class="camera-reconnecting-box">
              <img class="camera-reconnecting-logo" src="./assets/karenvision-mark.svg" alt="" aria-hidden="true">
              <div class="camera-reconnecting-brand">KarenVision</div>
              <div class="camera-reconnecting-msg">Reconectando<span class="r-dot">.</span><span class="r-dot">.</span><span class="r-dot">.</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  spawnLeavingTileClones(leavingTiles, gridRect) {
    if (!this.gridEl) {
      return;
    }

    for (const item of leavingTiles) {
      const clone = item.clone;
      clone.classList.add("is-leaving", "is-animating");
      clone.style.position = "absolute";
      clone.style.margin = "0";
      clone.style.left = `${item.rect.left - gridRect.left}px`;
      clone.style.top = `${item.rect.top - gridRect.top}px`;
      clone.style.width = `${item.rect.width}px`;
      clone.style.height = `${item.rect.height}px`;
      clone.style.zIndex = "6";
      clone.style.pointerEvents = "none";
      this.gridEl.appendChild(clone);

      requestAnimationFrame(() => {
        clone.style.opacity = "0";
        clone.style.transform = "scale(0.96)";
      });

      const cleanupId = window.setTimeout(() => {
        clone.remove();
        this.pendingAnimationCleanupIds.delete(cleanupId);
      }, 100);
      this.pendingAnimationCleanupIds.add(cleanupId);
    }
  }

  runGridFlip(beforeRects) {
    if (!this.gridInnerEl) {
      return;
    }

    const tiles = Array.from(this.gridInnerEl.querySelectorAll(".camera-cell"));
    const afterRects = new Map();
    for (const tile of tiles) {
      const key = tile.getAttribute("data-tile-key");
      if (!key) {
        continue;
      }
      afterRects.set(key, tile.getBoundingClientRect());
    }

    for (const tile of tiles) {
      const key = tile.getAttribute("data-tile-key");
      if (!key) {
        continue;
      }

      const before = beforeRects.get(key);
      const after = afterRects.get(key);
      if (!after) {
        continue;
      }

      tile.classList.add("is-animating");

      if (before) {
        const deltaX = before.left - after.left;
        const deltaY = before.top - after.top;
        const scaleX = after.width > 0 ? before.width / after.width : 1;
        const scaleY = after.height > 0 ? before.height / after.height : 1;

        tile.style.transformOrigin = "top left";
        tile.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
        tile.style.opacity = "1";

        requestAnimationFrame(() => {
          tile.style.transform = "translate(0, 0) scale(1, 1)";
          tile.style.opacity = "1";
        });
      } else {
        tile.classList.add("is-entering");
        tile.style.transformOrigin = "center";
        tile.style.opacity = "0";
        tile.style.transform = "scale(0.96)";

        requestAnimationFrame(() => {
          tile.classList.remove("is-entering");
          tile.style.opacity = "1";
          tile.style.transform = "scale(1)";
        });
      }

      const cleanupId = window.setTimeout(() => {
        tile.classList.remove("is-animating", "is-entering");
        tile.style.transform = "";
        tile.style.opacity = "";
        tile.style.transformOrigin = "";
        this.pendingAnimationCleanupIds.delete(cleanupId);
      }, 190);
      this.pendingAnimationCleanupIds.add(cleanupId);
    }
  }

  _tickClock() {
    if (!this.gridInnerEl) return;
    const nodes = this.gridInnerEl.querySelectorAll("[data-timestamp]");
    if (!nodes.length) return;

    const now  = new Date();
    const pad  = (n) => String(n).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const text = `${date}  ${time}`;

    for (const el of nodes) el.textContent = text;
  }

  // Fit the grid-inner so every cell is exactly CAMERA_AR (16:9).
  // The grid is centered in the available space; excess space shows as dark bg.
  _fitGridToAspect(W, H) {
    const CAMERA_AR = 16 / 9;
    const dim       = parseInt(this.currentLayout, 10) || 2; // cols = rows
    const gap       = dim >= 4 ? 4 : dim >= 3 ? 6 : 8;

    // Available space for cell content (subtract gaps between cells)
    const wAvail = W - (dim - 1) * gap;
    const hAvail = H - (dim - 1) * gap;

    // Size by width: each cell = wAvail/dim wide, height = width / AR
    const cellWbyW = wAvail / dim;
    const cellHbyW = cellWbyW / CAMERA_AR;
    const gridHbyW = cellHbyW * dim + (dim - 1) * gap;

    let finalW, finalH;
    if (gridHbyW <= H) {
      // Grid fits vertically → use full width, center vertically
      finalW = W;
      finalH = gridHbyW;
    } else {
      // Too tall → size by height instead, center horizontally
      const cellHbyH = hAvail / dim;
      const cellWbyH = cellHbyH * CAMERA_AR;
      finalH = H;
      finalW = cellWbyH * dim + (dim - 1) * gap;
    }

    this.gridInnerEl.style.width  = Math.round(finalW) + "px";
    this.gridInnerEl.style.height = Math.round(finalH) + "px";
  }

  _setStreamStatus(channelInt, state) {
    const el = this.gridInnerEl && this.gridInnerEl.querySelector(`[data-stream-status-for="${channelInt}"]`);
    if (!el) return;
    const dot   = el.querySelector(".stream-status-dot");
    const label = el.querySelector(".stream-status-label");
    const labels = {
      connecting:       "Conectando…",
      streaming:        "En vivo",
      timeout:          "Sin señal",
      error:            "Error stream",
      ended:            "Stream cerrado",
      mime_unsupported: "Codec no soportado",
      reconnecting:     "Reconectando…",
    };
    el.dataset.streamState = state;
    if (label) label.textContent = labels[state] || state;
    el.style.display = state === "streaming" ? "none" : "";
    if (dot) dot.style.background = (
      { streaming: "#00c853", error: "#ff1744", ended: "#9e9e9e", reconnecting: "#ff9800", timeout: "#ff1744" }
    )[state] || "#ffc107";

    // Reconnecting overlay: cubre el frame congelado con branding KarenVision
    const overlay = this.gridInnerEl.querySelector(`[data-reconnect-overlay-for="${channelInt}"]`);
    if (overlay) overlay.hidden = state !== "reconnecting";

    // Watchdog: si lleva >90s reconectando → hard reset completo
    if (state === "reconnecting") {
      this._startWatchdog(channelInt);
    } else {
      this._clearWatchdog(channelInt);
    }
  }

  _startWatchdog(channelInt) {
    if (this._watchdogs?.has(channelInt)) return;
    const id = setTimeout(() => {
      this._watchdogs?.delete(channelInt);
      if (!this.gridInnerEl) return;
      const videoEl = this.gridInnerEl.querySelector(`video[data-stream-channel="${channelInt}"]`);
      if (!videoEl?.isConnected) return;
      if (videoEl.dataset.streamState !== "reconnecting") return;
      console.warn(`[KV][ViewGroup] ch=${channelInt} watchdog: +90s reconectando → hard reset`);
      this._hardResetChannel(channelInt, videoEl);
    }, 90_000);
    this._watchdogs?.set(channelInt, id);
  }

  _clearWatchdog(channelInt) {
    const id = this._watchdogs?.get(channelInt);
    if (id != null) { clearTimeout(id); this._watchdogs.delete(channelInt); }
  }

  // No hay idToken (not_logged_in) o el 401 persistió tras el intento de
  // refresh en main/ipc/kv-ipc.js (play_live_ui_failed + status 401) — en
  // ambos casos no hay sesión de Google válida y reintentar no sirve de
  // nada: hay que cerrar sesión y volver a pedir login, no seguir en bucle.
  _isAuthExpired(tokenResp) {
    if (!tokenResp) return false;
    if (tokenResp.error === "not_logged_in") return true;
    if (tokenResp.error === "play_live_ui_failed" && Number(tokenResp.status) === 401) return true;
    return false;
  }

  _notifyAuthExpired() {
    if (this._authExpiredNotified) return;
    this._authExpiredNotified = true;
    this.deps.onAuthExpired?.();
  }

  _cancelRetryTimer(channel) {
    const id = this._retryTimers?.get(channel);
    if (id != null) { clearTimeout(id); this._retryTimers.delete(channel); }
  }

  _hardResetChannel(channelInt, videoEl) {
    this._cancelRetryTimer(channelInt);
    stopStream(videoEl);
    this._scheduleInitialRetry(videoEl, channelInt, 0);
  }

  _attachCameraStreams() {
    if (!this.gridInnerEl || !this.deps.getStreamToken) return;

    const videos = this.gridInnerEl.querySelectorAll("video[data-stream-channel]");
    for (const videoEl of videos) {
      const channel = parseInt(videoEl.dataset.streamChannel, 10);
      if (!Number.isFinite(channel) || channel < 1) continue;

      // Show "Reconectando" immediately on offline, after 5s for quick drops
      let _reconnectBadgeTimer = null;
      videoEl.addEventListener("stream:reconnecting", (evt) => {
        clearTimeout(_reconnectBadgeTimer);
        const delay = evt.detail.immediate ? 0 : 5000;
        _reconnectBadgeTimer = setTimeout(() => {
          this._setStreamStatus(evt.detail.channel, "reconnecting");
        }, delay);
      });
      videoEl.addEventListener("playing", () => {
        clearTimeout(_reconnectBadgeTimer);
        _reconnectBadgeTimer = null;
        this._setStreamStatus(channel, "streaming");
      });

      this.deps.getStreamToken(channel)
        .then((tokenResp) => {
          if (!tokenResp || !tokenResp.ok) {
            if (this._isAuthExpired(tokenResp)) {
              console.warn(`[KV][ViewGroup] ch=${channel} sesion vencida — cerrando sesion`);
              this._setStreamStatus(channel, "reconnecting");
              this._notifyAuthExpired();
              return;
            }
            console.warn(`[KV][ViewGroup] ch=${channel} token error — reconectando`);
            this._setStreamStatus(channel, "reconnecting");
            this._scheduleInitialRetry(videoEl, channel, 0);
            return;
          }
          this._launchStream(videoEl, channel, tokenResp);
        })
        .catch((err) => {
          console.warn(`[KV][ViewGroup] ch=${channel} stream attach failed — reconectando:`, err.message || err);
          this._setStreamStatus(channel, "reconnecting");
          this._scheduleInitialRetry(videoEl, channel, 0);
        });
    }
  }

  _launchStream(videoEl, channel, tokenResp) {
    // Cancelar cualquier retry pendiente — stream-service asume el control aquí
    this._cancelRetryTimer(channel);

    // Si en 12s no hay imagen ni reconexión activa → iniciar reconexión
    const connectTimeout = setTimeout(() => {
      this._setStreamStatus(channel, "reconnecting");
      this._scheduleInitialRetry(videoEl, channel, 0);
    }, 12000);

    const clearConn = () => clearTimeout(connectTimeout);

    videoEl.addEventListener("playing",             clearConn, { once: true });
    videoEl.addEventListener("error",               clearConn, { once: true });
    videoEl.addEventListener("stream:reconnecting", clearConn, { once: true });

    videoEl.addEventListener("playing", () => {
      this._setStreamStatus(channel, "streaming");
    }, { once: true });

    startStream(videoEl, {
      baseUrl: this.deps.baseUrl,
      channel,
      token:  tokenResp.token,
      apiKey: tokenResp.api_key || null,
      onReconnect: async () => {
        const fresh = await this.deps.getStreamToken?.(channel);
        if (!fresh || !fresh.ok) {
          if (this._isAuthExpired(fresh)) this._notifyAuthExpired();
          return null;
        }
        return { token: fresh.token, apiKey: fresh.api_key || null };
      },
    }).then((result) => {
      // stream-service maneja toda la reconexión tras lanzar el stream.
      // Solo manejamos fallos duros (mpegts no disponible, player no creado).
      if (!result.ok) {
        clearTimeout(connectTimeout);
        this._setStreamStatus(channel, "reconnecting");
        this._scheduleInitialRetry(videoEl, channel, 0);
      }
    }).catch(() => {
      clearTimeout(connectTimeout);
      this._setStreamStatus(channel, "reconnecting");
    });
  }

  _scheduleInitialRetry(videoEl, channel, attempt) {
    this._cancelRetryTimer(channel); // cancela el anterior si hay uno
    const DELAYS = [2000, 4000, 6000, 8000];
    const delay = DELAYS[Math.min(attempt, DELAYS.length - 1)];
    const timerId = setTimeout(async () => {
      this._retryTimers?.delete(channel);
      if (!videoEl.isConnected) return;
      let tokenResp;
      try {
        tokenResp = await this.deps.getStreamToken?.(channel);
      } catch (_) {
        tokenResp = null;
      }
      if (!tokenResp || !tokenResp.ok) {
        if (this._isAuthExpired(tokenResp)) {
          this._setStreamStatus(channel, "reconnecting");
          this._notifyAuthExpired();
          return;
        }
        this._setStreamStatus(channel, "reconnecting");
        this._scheduleInitialRetry(videoEl, channel, attempt + 1);
        return;
      }
      this._launchStream(videoEl, channel, tokenResp);
    }, delay);
    this._retryTimers?.set(channel, timerId);
  }

  // ── Fullscreen con zoom al hacer doble-click en una cámara ────────────────

  _bindCellDblClick() {
    if (!this.gridInnerEl) return;
    this.gridInnerEl.querySelectorAll(".camera-cell:not(.is-placeholder)").forEach(cell => {
      cell.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (this._focusOverlay) {
          this._exitCellFocus();
        } else {
          this._enterCellFocus(cell);
        }
      });
    });
  }

  _enterCellFocus(cell) {
    const video = cell.querySelector("video.camera-video");
    if (!video) return;

    // Mover el video al overlay para no cortar el stream
    const originalParent = video.parentNode;
    const placeholder = document.createComment("vg-video-placeholder");
    originalParent.replaceChild(placeholder, video);

    video.style.transform = "scale(1)";
    video.style.transformOrigin = "center center";
    video.style.transition = "transform 0.12s ease";
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "contain";
    video.style.display = "block";

    const wrapper = document.createElement("div");
    wrapper.className = "vg-focus-wrapper";
    wrapper.appendChild(video);

    const overlay = document.createElement("div");
    overlay.className = "vg-focus-overlay";
    overlay.appendChild(wrapper);
    document.body.appendChild(overlay);

    this._focusOverlay = overlay;
    this._focusState = { video, placeholder, parent: originalParent, scale: 1, originX: 50, originY: 50 };

    const onWheel = (e) => {
      e.preventDefault();
      const s = this._focusState;
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      s.scale = Math.min(6, Math.max(1, s.scale + delta));
      // Zoom centrado en el cursor
      const rect = video.getBoundingClientRect();
      s.originX = ((e.clientX - rect.left) / rect.width) * 100;
      s.originY = ((e.clientY - rect.top)  / rect.height) * 100;
      video.style.transformOrigin = `${s.originX}% ${s.originY}%`;
      video.style.transform = `scale(${s.scale})`;
      overlay.style.cursor = s.scale > 1 ? "zoom-out" : "zoom-in";
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") this._exitCellFocus();
    };

    const onDblClick = (e) => {
      e.preventDefault();
      this._exitCellFocus();
    };

    overlay.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKeyDown);
    overlay.addEventListener("dblclick", onDblClick);

    this._focusCleanup = () => {
      overlay.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKeyDown);
      overlay.removeEventListener("dblclick", onDblClick);
    };

    requestAnimationFrame(() => overlay.classList.add("vg-focus-in"));
  }

  _exitCellFocus() {
    if (!this._focusOverlay || !this._focusState) return;
    const { video, placeholder, parent } = this._focusState;

    video.style.transform = "";
    video.style.transformOrigin = "";
    video.style.transition = "";
    video.style.width = "";
    video.style.height = "";
    video.style.objectFit = "";
    video.style.display = "";

    parent.replaceChild(video, placeholder);
    this._focusOverlay.remove();
    this._focusCleanup?.();
    this._focusOverlay = null;
    this._focusState = null;
  }

  destroy() {
    this._exitCellFocus();
    this._ro?.disconnect();
    this._ro = null;
    clearInterval(this._clockInterval);
    this._clockInterval = null;

    // Limpiar watchdogs y retry timers activos
    if (this._watchdogs) {
      for (const id of this._watchdogs.values()) clearTimeout(id);
      this._watchdogs.clear();
    }
    if (this._retryTimers) {
      for (const id of this._retryTimers.values()) clearTimeout(id);
      this._retryTimers.clear();
    }

    // Stop all active streams before tearing down DOM
    if (this.gridInnerEl) {
      stopAllStreams(this.gridInnerEl);
    }

    for (const cleanupId of this.pendingAnimationCleanupIds) {
      window.clearTimeout(cleanupId);
    }
    this.pendingAnimationCleanupIds.clear();

    this.duplicateBtn?.removeEventListener("click", this.onDuplicateClick);
    this.layoutBtn?.removeEventListener("click", this.onLayoutButtonClick);
    this.layoutBtn?.removeEventListener("keydown", this.onLayoutButtonKeyDown);

    this.duplicateBtn = null;
    this.layoutBtn = null;
    this.gridInnerEl = null;
    this.gridEl = null;

    if (this.rootEl?.isConnected) {
      this.rootEl.remove();
    }
    this.rootEl = null;
  }
}
