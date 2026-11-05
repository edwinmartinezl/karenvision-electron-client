// Playback Module — timeline 24h interactivo

const DAYS   = ["Do","Lu","Ma","Mi","Ju","Vi","Sa"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAY_MS = 86_400_000;

function fmt2(n) { return String(Math.floor(n)).padStart(2,"0"); }
function fmtHMS(d) { return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}:${fmt2(d.getSeconds())}`; }
function fmtDate(d) { return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`; }
function fmtDur(sec) {
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return h > 0 ? `${h}h ${fmt2(m)}m` : m > 0 ? `${m}m ${fmt2(s)}s` : `${fmt2(s)}s`;
}
function secsOfDay(date) { return (date.getHours()*3600 + date.getMinutes()*60 + date.getSeconds()); }
function fmtDurationHMS(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${fmt2(h)}:${fmt2(m)}:${fmt2(sec)}`;
}
function pctOfDay(date, dayStart) { return Math.min(1, Math.max(0, (date - dayStart) / DAY_MS)); }
function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// Límite nativo de playbackRate en Chromium/Electron (~16×).
// Para velocidades mayores se usa frame-skip (setInterval + currentTime).
const NATIVE_MAX_RATE = 16;
const SKIP_INTERVAL_MS = 80; // tick cada 80ms para frame-skip

// Hueco entre el fin de un clip y el inicio del siguiente que todavía se
// considera "grabación continua" (reinicio de ffmpeg al rotar de segmento,
// medido en la práctica ~0.1-0.2s) — por debajo de esto se fusionan visualmente
// en la línea de tiempo. Los huecos reales (cámara offline, etc.) son de
// minutos u horas, muy por encima de este umbral.
const RUN_MERGE_EPSILON_MS = 3000;

// Job de exportación activo — a nivel de módulo (no de instancia) porque
// _mountPlayback destruye y recrea el PlaybackModule al navegar fuera y
// volver a entrar (ver app-controller.js). Así el polling se retoma solo
// con el job_id, sin perder pista del export en curso entre navegaciones
// dentro de la misma sesión de la app.
let _activeExportJobId = null;

export class PlaybackModule {
  constructor(mountEl, api) {
    this._el       = mountEl;
    this._api      = api;
    this._root     = null;
    this._calDate  = new Date();
    this._selDate  = new Date();
    this._items    = [];
    this._clips    = [];
    this._activeClipIdx = -1;
    this._dayStart = null;
    this._daysWithData = new Set();
    this._dragging = false;
    this._dragMode = null;      // "seek" | "select" — fijado en mousedown
    this._selectAnchor = null;  // dayPct donde empezó el Ctrl+drag de selección
    this._proxy    = null;
    this._skipInterval = null;
    this._currentSpeed  = 1;
    this._tlZoom        = 1;    // 1=día completo, >1=zoom
    this._tlCenter      = 0.5;  // fracción del día en el centro
    this._lastDayPct    = null; // última posición del cursor
    this._inPoint        = null; // marca "I" — preparación para exportación
    this._outPoint       = null; // marca "O"
    this._loopRange      = null; // { start, end } — bucle activo del rango marcado
  }

  mount() {
    this._root = document.createElement("div");
    this._root.className = "pb-root";
    this._root.innerHTML = `
      <div class="pb-sidebar">
        <div class="pb-sidebar-header">
          <div class="pb-sidebar-title">Grabaciones — Canal 1</div>
          <div class="pb-cal" id="pb-cal"></div>
        </div>
        <div class="pb-day-info" id="pb-day-info">
          <div class="pb-day-label" id="pb-day-label">—</div>
          <div class="pb-day-stats" id="pb-day-stats"></div>
        </div>

        <!-- Rango In/Out (I / O / Esc) + exportación real a .mp4 -->
        <div class="pb-export-panel" id="pb-export-panel">
          <div class="pb-export-title">Rango seleccionado</div>
          <div class="pb-export-row">
            <span class="pb-export-label">Entrada</span>
            <span class="pb-export-value" id="pb-export-in">—</span>
          </div>
          <div class="pb-export-row">
            <span class="pb-export-label">Salida</span>
            <span class="pb-export-value" id="pb-export-out">—</span>
          </div>
          <div class="pb-export-duration" id="pb-export-duration">—</div>
          <div class="pb-export-size" id="pb-export-size"></div>

          <div class="pb-export-form" id="pb-export-form">
            <div class="pb-export-title pb-export-title-export">Exportar</div>
            <div class="pb-export-row">
              <span class="pb-export-label">Formato</span>
              <span class="pb-export-value">MP4</span>
            </div>
            <button class="pb-export-btn" id="pb-export-btn" disabled>Exportar</button>
          </div>

          <div class="pb-export-progress" id="pb-export-progress">
            <div class="pb-export-progress-label" id="pb-export-progress-label">Exportando…</div>
            <div class="pb-export-progress-bar">
              <div class="pb-export-progress-fill" id="pb-export-progress-fill"></div>
            </div>
            <button class="pb-export-cancel-btn" id="pb-export-cancel-btn">✕ Cancelar</button>
          </div>

        </div>
      </div>

      <div class="pb-player-panel">
        <!-- Video -->
        <div class="pb-video-wrap" id="pb-video-wrap">
          <div class="pb-empty-state" id="pb-empty">
            <div class="pb-empty-icon">🎬</div>
            <div class="pb-empty-text">Selecciona un día en el calendario<br>y haz clic en la línea de tiempo</div>
            <button class="pb-play-start" id="pb-play-start" disabled>▶ Reproducir desde el inicio</button>
          </div>
          <div class="pb-nosignal" id="pb-nosignal">
            <div class="pb-nosignal-icon">📷</div>
            <div class="pb-nosignal-text">Sin grabación en este momento</div>
            <div class="pb-nosignal-time" id="pb-nosignal-time"></div>
          </div>
          <video class="pb-video" id="pb-video" playsinline></video>
        </div>

        <!-- Controles de reproducción -->
        <div class="pb-controls" id="pb-controls">
          <button class="pb-ctrl-btn pb-ctrl-play" id="pb-ctrl-play">▶ Reproducir</button>
          <button class="pb-ctrl-btn" id="pb-ctrl-prev" disabled>◀◀ Anterior</button>
          <button class="pb-ctrl-btn" id="pb-ctrl-next" disabled>Siguiente ▶▶</button>
          <div class="pb-ctrl-sep"></div>
          <span class="pb-ctrl-label">Velocidad</span>
          ${[0.5,1,2,4,8,16,32].map(s =>
            `<button class="pb-ctrl-btn${s===1?" active":""}" data-speed="${s}">${s}×</button>`
          ).join("")}
          <div class="pb-ctrl-spacer"></div>
          <span class="pb-ctrl-label" id="pb-ctrl-info">—</span>
        </div>

        <!-- Timeline 24h -->
        <div class="pb-timeline-section">
          <div class="pb-tl-header">
            <span class="pb-tl-now" id="pb-tl-now">—</span>
            <span class="pb-tl-range">00:00 — 24:00</span>
          </div>

          <div class="pb-tl-bar-wrap" id="pb-tl-bar-wrap">
            <div class="pb-tl-bar" id="pb-tl-bar">
              <!-- clips y cursor se insertan por JS -->
            </div>
            <div class="pb-tl-tooltip" id="pb-tl-tooltip"></div>
          </div>

          <div class="pb-tl-hours">
            ${[0,2,4,6,8,10,12,14,16,18,20,22,24].map(h =>
              `<span>${fmt2(h)}:00</span>`
            ).join("")}
          </div>
        </div>
      </div>

      <!-- Modal centrado — resultado de exportación (éxito/error) -->
      <div class="pb-modal-backdrop" id="pb-export-modal-backdrop">
        <div class="pb-modal-box">
          <div class="pb-modal-icon" id="pb-export-modal-icon"></div>
          <div class="pb-modal-message" id="pb-export-modal-message"></div>
          <button class="pb-modal-close-btn" id="pb-export-modal-close">Aceptar</button>
        </div>
      </div>
    `;
    this._el.appendChild(this._root);
    this._bindControls();
    this._bindTimelineEvents();
    this._root.querySelector("#pb-tl-bar")?.addEventListener("mousedown", (e) => {
      this._dragging = true;
      if (e.ctrlKey) {
        const dayPct = this._dayPctFromEvent(e);
        if (dayPct == null) return;
        this._dragMode = "select";
        this._selectAnchor = dayPct;
        this._inPoint  = new Date(this._dayStart.getTime() + dayPct * DAY_MS);
        this._outPoint = null;
        this._loopRange = null;
        this._setCursor(dayPct);
        this._renderTimeline();
        this._updateExportPanel();
        e.currentTarget.classList.add("pb-tl-select-dragging");
      } else {
        this._dragMode = "seek";
        this._handleTimelineInteraction(e);
      }
    });
    this._root.querySelector("#pb-tl-bar-wrap")?.addEventListener("mousemove", (e) => {
      const bar = this._tlBar();
      const tip = this._tooltip();
      if (!bar || !tip || !this._dayStart) return;
      const rect   = bar.getBoundingClientRect();
      const barPct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const { start: vs, end: ve } = this._visWindow();
      const dayPct = vs + barPct * (ve - vs);
      const t = new Date(this._dayStart.getTime() + dayPct * DAY_MS);
      tip.textContent = fmtHMS(t);
      tip.style.left  = (e.clientX - rect.left) + "px";
    });

    // Ctrl + rueda → zoom sobre el cursor
    this._root.querySelector("#pb-tl-bar-wrap")?.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const bar = this._tlBar();
      if (!bar || !this._dayStart) return;

      const { start: vs, end: ve } = this._visWindow();
      const rect   = bar.getBoundingClientRect();
      const barPct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const pivot  = vs + barPct * (ve - vs); // fracción del día bajo el cursor

      const factor = e.deltaY < 0 ? 1.5 : (1 / 1.5);
      this._tlZoom = Math.max(1, Math.min(1440, this._tlZoom * factor));

      // Mantener el punto bajo el cursor en su misma posición visual
      const half = 0.5 / this._tlZoom;
      this._tlCenter = Math.max(half, Math.min(1 - half, pivot - barPct * (1 / this._tlZoom) + half));

      this._renderTimeline();
      if (this._lastDayPct != null) this._setCursor(this._lastDayPct);
    }, { passive: false });
    this._onKeyDown = (e) => this._handleKeyDown(e);
    document.addEventListener("keydown", this._onKeyDown);

    // Cursor de mano mientras se mantiene Ctrl sobre la barra — mismo
    // gesto que dispara la selección de rango en mousedown (ver
    // _updateRangeDrag), esto es solo el feedback visual de "puedo
    // agarrar esto". "grabbing" mientras el arrastre está activo.
    this._onCtrlCursorToggle = (e) => {
      if (e.key !== "Control") return;
      const bar = this._tlBar();
      if (!bar) return;
      bar.classList.toggle("pb-tl-ctrl-hover", e.type === "keydown");
    };
    document.addEventListener("keydown", this._onCtrlCursorToggle);
    document.addEventListener("keyup",   this._onCtrlCursorToggle);
    // Por si Ctrl se soltó fuera de la ventana (alt-tab, etc.) y el keyup
    // nunca llegó — al volver el foco, el cursor no debe quedar pegado.
    this._onWindowBlur = () => this._tlBar()?.classList.remove("pb-tl-ctrl-hover");
    window.addEventListener("blur", this._onWindowBlur);

    this._scanMonth(this._calDate);
    this._renderCalendar();
    // Abrir hoy por defecto
    this._selectDay(new Date());
  }

  destroy() {
    this._stopSkip();
    // No se limpia _activeExportJobId (es a nivel de módulo, a propósito)
    // — solo el timer de esta instancia, para que un export en curso siga
    // corriendo del lado del servidor y se retome al volver a entrar.
    if (this._exportPollTimer) { clearInterval(this._exportPollTimer); this._exportPollTimer = null; }
    if (this._exportSizeDebounce) { clearTimeout(this._exportSizeDebounce); this._exportSizeDebounce = null; }
    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("mouseup",   this._onMouseUp);
    document.removeEventListener("keydown",   this._onKeyDown);
    document.removeEventListener("keydown",   this._onCtrlCursorToggle);
    document.removeEventListener("keyup",     this._onCtrlCursorToggle);
    window.removeEventListener("blur",        this._onWindowBlur);
    const v = this._video();
    if (v) { v.pause(); v.src = ""; }
    this._root?.remove();
    this._root = null;
  }

  // ── Helpers DOM ───────────────────────────────────────────────────────────
  _$(id) { return this._root?.querySelector(`#${id}`); }
  _video()   { return this._$("pb-video"); }
  _tlBar()   { return this._$("pb-tl-bar"); }
  _tooltip() { return this._$("pb-tl-tooltip"); }

  // ── Calendario ────────────────────────────────────────────────────────────
  _renderCalendar() {
    const cal = this._$("pb-cal");
    if (!cal) return;
    const y = this._calDate.getFullYear(), m = this._calDate.getMonth();
    const todayStr = fmtDate(new Date());
    const selStr   = fmtDate(this._selDate);
    const firstDay = new Date(y, m, 1).getDay();
    const days     = new Date(y, m+1, 0).getDate();

    let grid = DAYS.map(d => `<div class="pb-cal-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDay; i++) grid += `<div class="pb-cal-day empty"></div>`;
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${fmt2(m+1)}-${fmt2(d)}`;
      grid += `<div class="pb-cal-day
        ${this._daysWithData.has(ds) ? "has-rec" : ""}
        ${ds === selStr   ? "selected" : ""}
        ${ds === todayStr ? "today"    : ""}"
        data-date="${ds}">${d}</div>`;
    }

    cal.innerHTML = `
      <div class="pb-cal-header">
        <button class="pb-cal-nav" id="pb-cal-prev">‹</button>
        <div class="pb-cal-month">${MONTHS[m]} ${y}</div>
        <button class="pb-cal-nav" id="pb-cal-next">›</button>
      </div>
      <div class="pb-cal-grid">${grid}</div>
    `;
    cal.querySelector("#pb-cal-prev").addEventListener("click", () => {
      this._calDate = new Date(y, m-1, 1);
      this._scanMonth(this._calDate);
      this._renderCalendar();
    });
    cal.querySelector("#pb-cal-next").addEventListener("click", () => {
      this._calDate = new Date(y, m+1, 1);
      this._scanMonth(this._calDate);
      this._renderCalendar();
    });
    cal.querySelectorAll(".pb-cal-day[data-date]").forEach(el =>
      el.addEventListener("click", () => {
        const [dy,dm,dd] = el.dataset.date.split("-").map(Number);
        this._selectDay(new Date(dy, dm-1, dd));
      })
    );
  }

  async _scanMonth(date) {
    const y = date.getFullYear(), m = date.getMonth();
    const from = new Date(y, m, 1).toISOString();
    const to   = new Date(y, m+1, 0, 23, 59, 59).toISOString();
    try {
      const res = await this._api({ method: "POST", path: "/playback/info",
        body: { channel: 1, from_ts: from, to_ts: to } });
      if (!res?.ok) return;
      (res.data?.items || []).filter(i => i.type === "clip").forEach(c => {
        this._daysWithData.add(new Date(c.clip_from).toISOString().slice(0,10));
      });
      this._renderCalendar();
    } catch (_) {}
  }

  // ── Día seleccionado ──────────────────────────────────────────────────────
  async _selectDay(date) {
    this._selDate  = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    this._dayStart = this._selDate;
    this._calDate  = new Date(date.getFullYear(), date.getMonth(), 1);
    this._inPoint    = null;
    this._outPoint   = null;
    this._loopRange  = null;
    this._updateExportPanel();
    this._checkActiveExport();
    this._renderCalendar();

    const label = this._$("pb-day-label");
    if (label) label.textContent =
      `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;

    const stats = this._$("pb-day-stats");
    if (stats) stats.textContent = "Cargando…";

    const from = new Date(date.getFullYear(), date.getMonth(), date.getDate(),  0, 0, 0).toISOString();
    const to   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23,59,59).toISOString();

    try {
      const res = await this._api({ method: "POST", path: "/playback/info",
        body: { channel: 1, from_ts: from, to_ts: to } });
      if (!res?.ok) { if (stats) stats.textContent = "Error al cargar"; return; }

      this._items = res.data?.items || [];
      this._clips = this._items.filter(i => i.type === "clip");
      this._activeClipIdx = -1;

      const recSec = Math.round(res.data?.recorded_sec || 0);
      if (stats) stats.textContent = this._clips.length
        ? fmtDur(recSec)
        : "Sin grabaciones";

      // Habilitar/deshabilitar botón de inicio
      const playStart = this._$("pb-play-start");
      if (playStart) playStart.disabled = this._clips.length === 0;
      this._updateNavBtns();

      this._renderTimeline();
      this._showEmpty();
    } catch (err) {
      if (stats) stats.textContent = "Error: " + err.message;
    }
  }

  // ── Ventana visible del timeline ──────────────────────────────────────────
  _visWindow() {
    const half = 0.5 / this._tlZoom;
    let s = this._tlCenter - half;
    let e = this._tlCenter + half;
    if (s < 0) { e = Math.min(1, e - s); s = 0; }
    if (e > 1) { s = Math.max(0, s - (e - 1)); e = 1; }
    return { start: s, end: e };
  }

  // Fusiona clips consecutivos (this._clips ya viene ordenado por inicio,
  // tal como lo arma el resolver del backend) en franjas continuas.
  _mergedRecordedRuns() {
    const runs = [];
    for (const clip of this._clips) {
      const cs = new Date(clip.clip_from);
      const ce = new Date(clip.clip_to);
      const last = runs[runs.length - 1];
      if (last && cs - last.end <= RUN_MERGE_EPSILON_MS) {
        if (ce > last.end) last.end = ce;
      } else {
        runs.push({ start: cs, end: ce });
      }
    }
    return runs;
  }

  // ── Timeline ──────────────────────────────────────────────────────────────
  _renderTimeline() {
    const bar = this._tlBar();
    if (!bar) return;
    bar.innerHTML = "";

    const { start: vs, end: ve } = this._visWindow();

    // Segmentos de grabación (cian) dentro de la ventana visible. Se
    // fusionan los clips contiguos (fin de uno ~= inicio del siguiente,
    // dentro de RUN_MERGE_EPSILON_MS) en una sola franja continua — cada
    // clip es un archivo de 5 min separado, y renderizarlos uno por uno
    // dejaba "cortes" visibles entre ellos aunque la grabación nunca se
    // haya interrumpido de verdad.
    this._mergedRecordedRuns().forEach(run => {
      const clipS = pctOfDay(run.start, this._dayStart);
      const clipE = pctOfDay(run.end,   this._dayStart);
      const rs = Math.max(clipS, vs);
      const re = Math.min(clipE, ve);
      if (rs >= re) return;
      const left  = ((rs - vs) / (ve - vs)) * 100;
      const width = ((re - rs) / (ve - vs)) * 100;
      const seg = document.createElement("div");
      seg.className = "pb-tl-recorded";
      seg.style.left  = left.toFixed(3) + "%";
      seg.style.width = Math.max(0.1, width).toFixed(3) + "%";
      seg.title = `${fmtHMS(run.start)} → ${fmtHMS(run.end)}`;
      bar.appendChild(seg);
    });

    this._renderInOutSelection(bar, vs, ve);

    // Cursor (playhead)
    const cursor = document.createElement("div");
    cursor.id = "pb-cursor";
    cursor.className = "pb-tl-cursor";
    cursor.style.display = "none";
    bar.appendChild(cursor);

    this._renderTlHours(vs, ve);
    if (this._lastDayPct != null) this._setCursor(this._lastDayPct);
  }

  // Selección In/Out — marcada con las teclas I / O (Esc limpia), ver
  // _handleKeyDown(). Preparación visual para exportación: I sombrea desde
  // ese punto hasta el final del día; al marcar O, la sombra se acota al
  // rango I→O exacto. Respeta la ventana visible del zoom (vs/ve), igual
  // que los segmentos grabados.
  _renderInOutSelection(bar, vs, ve) {
    if (!this._inPoint) return;

    const outDate = this._outPoint || new Date(this._dayStart.getTime() + DAY_MS);
    const selS = pctOfDay(this._inPoint, this._dayStart);
    const selE = pctOfDay(outDate, this._dayStart);

    const rs = Math.max(selS, vs);
    const re = Math.min(selE, ve);
    if (rs < re) {
      const left  = ((rs - vs) / (ve - vs)) * 100;
      const width = ((re - rs) / (ve - vs)) * 100;
      const sel = document.createElement("div");
      sel.className = "pb-tl-selection";
      sel.style.left  = left.toFixed(3) + "%";
      sel.style.width = Math.max(0.05, width).toFixed(3) + "%";
      bar.appendChild(sel);
    }

    if (selS >= vs && selS <= ve) {
      const inMark = document.createElement("div");
      inMark.className = "pb-tl-io-marker pb-tl-io-in";
      inMark.style.left = (((selS - vs) / (ve - vs)) * 100).toFixed(3) + "%";
      inMark.title = `In: ${fmtHMS(this._inPoint)}`;
      bar.appendChild(inMark);
    }

    if (this._outPoint) {
      const outS = pctOfDay(this._outPoint, this._dayStart);
      if (outS >= vs && outS <= ve) {
        const outMark = document.createElement("div");
        outMark.className = "pb-tl-io-marker pb-tl-io-out";
        outMark.style.left = (((outS - vs) / (ve - vs)) * 100).toFixed(3) + "%";
        outMark.title = `Out: ${fmtHMS(this._outPoint)}`;
        bar.appendChild(outMark);
      }
    }
  }

  _renderTlHours(vs, ve) {
    const el = this._$("pb-tl-hours");
    if (!el) return;
    const spanSec = (ve - vs) * 86400;
    const tickSec = spanSec > 43200 ? 7200
                  : spanSec > 21600 ? 3600
                  : spanSec > 7200  ? 1800
                  : spanSec > 3600  ? 900
                  : spanSec > 1800  ? 600
                  : spanSec > 600   ? 300
                  : spanSec > 240   ? 120
                  :                   60;

    const startSec = vs * 86400;
    const endSec   = ve * 86400;
    el.innerHTML = "";
    const first = Math.ceil(startSec / tickSec) * tickSec;
    for (let t = first; t <= endSec + 1; t += tickSec) {
      const barPct = ((t / 86400) - vs) / (ve - vs) * 100;
      if (barPct < 0 || barPct > 100) continue;
      const h = Math.floor(t / 3600) % 24;
      const m = Math.floor((t % 3600) / 60);
      const span = document.createElement("span");
      span.textContent = `${fmt2(h)}:${fmt2(m)}`;
      span.style.left      = barPct.toFixed(2) + "%";
      span.style.transform = "translateX(-50%)";
      el.appendChild(span);
    }
  }

  _setCursor(dayPct) {
    this._lastDayPct = dayPct;
    const { start: vs, end: ve } = this._visWindow();
    const cursor = this._$("pb-cursor");
    if (cursor) {
      const inView = dayPct >= vs && dayPct <= ve;
      cursor.style.display = inView ? "" : "none";
      if (inView) {
        cursor.style.left = (((dayPct - vs) / (ve - vs)) * 100).toFixed(3) + "%";
      }
    }
    const now = this._$("pb-tl-now");
    if (now && this._dayStart) {
      const t = new Date(this._dayStart.getTime() + dayPct * DAY_MS);
      now.textContent = fmtHMS(t);
    }
  }

  // ── Controles ────────────────────────────────────────────────────────────
  _bindControls() {
    // Play desde inicio
    const playStart = this._$("pb-play-start");
    if (playStart) playStart.addEventListener("click", () => this._playFromStart());

    this._$("pb-export-btn")?.addEventListener("click", () => this._startExport());
    this._$("pb-export-cancel-btn")?.addEventListener("click", () => this._cancelExport());

    this._$("pb-export-modal-close")?.addEventListener("click", () => this._hideExportModal());
    this._$("pb-export-modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) this._hideExportModal();
    });

    // Play/Pause toggle — si hay un rango In/Out marcado, reproducir lo
    // arranca (o retoma) en bucle infinito dentro de ese rango. Pausar
    // sigue siendo un simple pausar; volver a reproducir retoma donde
    // quedó mientras el rango no haya cambiado (ver _isLoopActiveFor).
    const playBtn = this._$("pb-ctrl-play");
    if (playBtn) playBtn.addEventListener("click", () => {
      const v = this._video();
      if (v && !v.paused) { v.pause(); return; }

      if (this._inPoint && this._outPoint && !this._isLoopActiveFor(this._inPoint, this._outPoint)) {
        this._playSelectionLoop();
        return;
      }

      if (!v?.src) { this._playFromStart(); return; }
      v.play().catch(() => {});
    });

    // Anterior / Siguiente — navegación manual, rompe el bucle activo
    this._$("pb-ctrl-prev")?.addEventListener("click", () => {
      this._loopRange = null;
      if (this._activeClipIdx > 0) this._playClip(this._activeClipIdx - 1, 0);
    });
    this._$("pb-ctrl-next")?.addEventListener("click", () => {
      this._loopRange = null;
      if (this._activeClipIdx < this._clips.length - 1)
        this._playClip(this._activeClipIdx + 1, 0);
    });

    // Velocidad
    this._root?.querySelectorAll("[data-speed]").forEach(btn => {
      btn.addEventListener("click", () => {
        this._setSpeed(parseFloat(btn.dataset.speed));
        this._root?.querySelectorAll("[data-speed]").forEach(b =>
          b.classList.toggle("active", b === btn));
      });
    });

    // Actualizar botón play según estado del video
    const v = this._video();
    if (v) {
      v.addEventListener("play",  () => this._updatePlayBtn(false));
      v.addEventListener("pause", () => this._updatePlayBtn(true));
      v.addEventListener("ended", () => this._updatePlayBtn(true));
    }
  }

  _updatePlayBtn(paused) {
    const btn = this._$("pb-ctrl-play");
    if (btn) btn.textContent = paused ? "▶ Reproducir" : "⏸ Pausar";
  }

  _updateNavBtns() {
    const prev = this._$("pb-ctrl-prev");
    const next = this._$("pb-ctrl-next");
    if (prev) prev.disabled = this._activeClipIdx <= 0;
    if (next) next.disabled = this._activeClipIdx >= this._clips.length - 1;
  }

  _playFromStart() {
    if (this._clips.length > 0) this._playClip(0, 0);
  }

  // ── Bucle sobre el rango In/Out marcado ─────────────────────────────────
  _isLoopActiveFor(inPoint, outPoint) {
    return Boolean(
      this._loopRange &&
      this._loopRange.start.getTime() === inPoint.getTime() &&
      this._loopRange.end.getTime()   === outPoint.getTime()
    );
  }

  _playSelectionLoop() {
    if (!this._inPoint || !this._outPoint) return;
    this._loopRange = { start: this._inPoint, end: this._outPoint };
    this._seekToTime(this._inPoint);
  }

  _stopSkip() {
    if (this._skipInterval != null) {
      clearInterval(this._skipInterval);
      this._skipInterval = null;
    }
  }

  _setSpeed(speed) {
    this._currentSpeed = speed;
    const v = this._video();
    if (!v) return;

    this._stopSkip();

    if (speed <= NATIVE_MAX_RATE) {
      v.playbackRate = speed;
      if (v.paused && v.src) v.play().catch(() => {});
    } else {
      // Frame-skip: avanza currentTime manualmente cada tick
      v.playbackRate = 1;
      v.pause();
      const stepSec = speed * (SKIP_INTERVAL_MS / 1000);
      this._skipInterval = setInterval(() => {
        if (!v.src || !this._root) { this._stopSkip(); return; }
        const next = v.currentTime + stepSec;
        // Si superamos la duración del clip, pasar al siguiente
        if (next >= v.duration) {
          const idx = this._activeClipIdx;
          if (idx < this._clips.length - 1) {
            this._stopSkip();
            this._playClip(idx + 1, 0).then(() => this._setSpeed(speed));
          } else {
            this._stopSkip();
            this._updatePlayBtn(true);
          }
        } else {
          v.currentTime = next;
        }
      }, SKIP_INTERVAL_MS);
    }
  }

  _updateCtrlInfo(clip) {
    const el = this._$("pb-ctrl-info");
    if (!el || !clip) { if (el) el.textContent = "—"; return; }
    const s = new Date(clip.clip_from);
    const e = new Date(clip.clip_to);
    el.textContent = `${fmtHMS(s)} → ${fmtHMS(e)}  (${this._activeClipIdx+1}/${this._clips.length})`;
  }

  // ── Marcas In/Out (I / O / Esc) ──────────────────────────────────────────
  // Preparación visual para exportación — no dispara ninguna exportación
  // todavía, solo marca el rango en la línea de tiempo.
  _handleKeyDown(e) {
    // isConnected: si se navegó a otro módulo, viewHost.innerHTML = "" quitó
    // este root del DOM aunque la instancia siga viva (destroy() solo se
    // llama al re-entrar a Playback, no al salir a otro módulo).
    if (!this._root || !this._root.isConnected) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();
    if (key === "i") {
      e.preventDefault();
      this._setInPoint();
    } else if (key === "o") {
      e.preventDefault();
      this._setOutPoint();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this._clearInOutPoints();
    }
  }

  // Posición actual del cursor en la línea de tiempo (drag/click o
  // reproducción — _lastDayPct se actualiza en ambos casos vía _setCursor).
  _currentPlayheadDate() {
    if (this._lastDayPct == null || !this._dayStart) return null;
    return new Date(this._dayStart.getTime() + this._lastDayPct * DAY_MS);
  }

  _setInPoint() {
    const t = this._currentPlayheadDate();
    if (!t) return;
    this._inPoint = t;
    // Un Out ya marcado que quedó antes del nuevo In deja de ser válido.
    if (this._outPoint && this._outPoint <= this._inPoint) this._outPoint = null;
    this._loopRange = null;
    this._renderTimeline();
    this._updateExportPanel();
  }

  _setOutPoint() {
    if (!this._inPoint) return;
    const t = this._currentPlayheadDate();
    if (!t || t <= this._inPoint) return;
    this._outPoint = t;
    this._loopRange = null;
    this._renderTimeline();
    this._updateExportPanel();
  }

  _clearInOutPoints() {
    if (!this._inPoint && !this._outPoint) return;
    this._inPoint = null;
    this._outPoint = null;
    this._loopRange = null;
    this._renderTimeline();
    this._updateExportPanel();
  }

  // Panel de la izquierda con el rango In/Out — debajo de la fecha de la
  // grabación. Muestra entrada/salida/duración del rango marcado, y el
  // estado de exportación (form / progreso / resultado). El panel queda
  // visible tanto si hay un rango marcado como si hay un export en curso
  // (para poder salir de la pantalla, cambiar de día, y volver a ver el
  // progreso sin perder el rango que se estaba viendo antes).
  _updateExportPanel() {
    const panel = this._$("pb-export-panel");
    if (!panel) return;

    if (!this._inPoint && !_activeExportJobId) {
      panel.classList.remove("visible");
      return;
    }
    panel.classList.add("visible");

    const inEl  = this._$("pb-export-in");
    const outEl = this._$("pb-export-out");
    const durEl = this._$("pb-export-duration");
    const btn   = this._$("pb-export-btn");

    if (inEl) inEl.textContent = this._inPoint ? `${fmtDate(this._inPoint)} ${fmtHMS(this._inPoint)}` : "—";

    if (this._inPoint && this._outPoint) {
      if (outEl) outEl.textContent = `${fmtDate(this._outPoint)} ${fmtHMS(this._outPoint)}`;
      const durSec = (this._outPoint - this._inPoint) / 1000;
      if (durEl) durEl.textContent = `Duración: ${fmtDurationHMS(durSec)}`;
      if (btn) btn.disabled = false;
      this._scheduleExportSizeEstimate();
    } else {
      if (outEl) outEl.textContent = "—";
      if (durEl) durEl.textContent = "—";
      if (btn) btn.disabled = true;
      const sizeEl = this._$("pb-export-size");
      if (sizeEl) sizeEl.textContent = "";
    }
  }

  // Peso aproximado del .mp4 antes de exportar — debounced para no
  // martillar el backend con ffprobe en cada pixel de un Ctrl+arrastrar.
  _scheduleExportSizeEstimate() {
    if (this._exportSizeDebounce) clearTimeout(this._exportSizeDebounce);
    this._exportSizeDebounce = setTimeout(() => this._fetchExportSizeEstimate(), 400);
  }

  async _fetchExportSizeEstimate() {
    if (!this._inPoint || !this._outPoint || !this._api) return;
    const inPoint = this._inPoint, outPoint = this._outPoint;
    const sizeEl = this._$("pb-export-size");
    if (sizeEl) sizeEl.textContent = "Calculando peso…";

    const res = await this._api({
      method: "GET", path: "/playback/export/estimate",
      query: { channel: 1, from_ts: inPoint.toISOString(), to_ts: outPoint.toISOString() },
    });

    // El rango pudo cambiar mientras la request estaba en vuelo.
    if (this._inPoint !== inPoint || this._outPoint !== outPoint) return;
    if (!sizeEl) return;
    if (!res?.ok || res.data?.estimated_bytes == null) {
      sizeEl.textContent = "";
      return;
    }
    sizeEl.textContent = `Peso aproximado: ${fmtBytes(res.data.estimated_bytes)}`;
  }

  // ── Exportación real a .mp4 (en background, con progreso y cancelación) ──

  _defaultExportName() {
    const stamp = (d) => `${d.getFullYear()}${fmt2(d.getMonth()+1)}${fmt2(d.getDate())}-${fmt2(d.getHours())}${fmt2(d.getMinutes())}${fmt2(d.getSeconds())}`;
    return `canal1_${stamp(this._inPoint)}_a_${stamp(this._outPoint)}.mp4`;
  }

  async _startExport() {
    if (!this._inPoint || !this._outPoint || !this._api) return;

    const picked = await window.kvClient?.pickSaveFile?.(this._defaultExportName());
    if (!picked || !picked.ok || !picked.path) return; // el usuario canceló el diálogo

    const res = await this._api({
      method: "POST",
      path: "/playback/export/start",
      body: {
        channel: 1,
        from_ts: this._inPoint.toISOString(),
        to_ts: this._outPoint.toISOString(),
        output_path: picked.path,
      },
    });

    if (!res?.ok || !res.data?.job_id) {
      this._showExportResult("error", res?.data?.detail || res?.data?.message || "No se pudo iniciar la exportación");
      return;
    }

    this._trackExportJob(res.data.job_id);
  }

  _trackExportJob(jobId) {
    _activeExportJobId = jobId;
    this._showExportProgress();
    this._updateExportPanel();
    if (this._exportPollTimer) clearInterval(this._exportPollTimer);
    this._exportPollTimer = setInterval(() => this._pollExportStatus(), 700);
    this._pollExportStatus();
  }

  // Rediscovery — se llama al montar/cambiar de día, para retomar el
  // seguimiento de un export que quedó corriendo del lado del servidor
  // aunque esta instancia del módulo se haya recreado (o la app se haya
  // recargado) mientras tanto.
  async _checkActiveExport() {
    if (!this._api) return;
    if (_activeExportJobId) { this._trackExportJob(_activeExportJobId); return; }

    const res = await this._api({ method: "GET", path: "/playback/export/list", query: { channel: 1 } });
    if (!res?.ok) return;
    const running = (res.data?.jobs || []).find(j => j.status === "running");
    if (running) this._trackExportJob(running.job_id);
  }

  async _pollExportStatus() {
    if (!_activeExportJobId || !this._api) return;
    const res = await this._api({
      method: "GET", path: "/playback/export/status", query: { job_id: _activeExportJobId },
    });

    // 404 = el servidor no conoce este job_id (p.ej. se reinició el
    // servicio con un export en curso) — no es un error transitorio,
    // hay que abandonar el seguimiento en vez de reintentar para
    // siempre. Cualquier otro !ok sí se trata como transitorio.
    if (res?.status === 404) {
      if (this._exportPollTimer) { clearInterval(this._exportPollTimer); this._exportPollTimer = null; }
      _activeExportJobId = null;
      this._showExportResult(null, null);
      this._updateExportPanel();
      return;
    }
    if (!res?.ok || !res.data) return; // error transitorio — reintenta en el próximo tick

    const job = res.data;
    if (job.status === "running") {
      this._renderExportProgress(job);
      return;
    }

    if (this._exportPollTimer) { clearInterval(this._exportPollTimer); this._exportPollTimer = null; }
    _activeExportJobId = null;

    if (job.status === "completed") {
      this._showExportResult("success", `✓ Exportado: ${job.output_path}`);
    } else if (job.status === "failed") {
      this._showExportResult("error", `Error: ${job.error || "fallo desconocido"}`);
    } else {
      this._showExportResult(null, null); // cancelled — vuelve al form sin mensaje
    }
    this._updateExportPanel();
  }

  async _cancelExport() {
    if (!_activeExportJobId || !this._api) return;
    await this._api({ method: "POST", path: "/playback/export/cancel", body: { job_id: _activeExportJobId } });
    this._pollExportStatus();
  }

  _showExportProgress() {
    const form = this._$("pb-export-form");
    const progress = this._$("pb-export-progress");
    if (form) form.style.display = "none";
    if (progress) progress.style.display = "flex";
  }

  _renderExportProgress(job) {
    const label = this._$("pb-export-progress-label");
    const fill  = this._$("pb-export-progress-fill");
    const verb = job.phase === "finalizing" ? "Finalizando" : "Exportando";
    if (label) label.textContent = `${verb}… ${job.current_item}/${job.total_items} (${job.progress_pct}%)`;
    if (fill) fill.style.width = `${job.progress_pct}%`;
  }

  // Resultado final — ventana emergente centrada (no cabía en el panel
  // angosto de la barra lateral, se cortaba con rutas largas).
  _showExportResult(type, message) {
    const form = this._$("pb-export-form");
    const progress = this._$("pb-export-progress");
    if (progress) progress.style.display = "none";
    if (form) form.style.display = "flex";
    if (!type || !message) return; // cancelled — vuelve al form, sin popup

    const backdrop = this._$("pb-export-modal-backdrop");
    const icon = this._$("pb-export-modal-icon");
    const msg  = this._$("pb-export-modal-message");
    if (!backdrop) return;
    if (icon) icon.textContent = type === "success" ? "✓" : "✗";
    if (msg) msg.textContent = message;
    backdrop.className = `pb-modal-backdrop visible ${type}`;
  }

  _hideExportModal() {
    const backdrop = this._$("pb-export-modal-backdrop");
    if (backdrop) backdrop.className = "pb-modal-backdrop";
  }

  // ── Interacción con la línea de tiempo ────────────────────────────────────
  _bindTimelineEvents() {
    this._onMouseMove = (e) => {
      if (!this._dragging) return;
      if (this._dragMode === "select") {
        this._updateRangeDrag(e);
      } else {
        this._handleTimelineInteraction(e);
      }
    };
    this._onMouseUp = (e) => {
      this._dragging  = false;
      this._dragMode  = null;
      this._selectAnchor = null;
      const bar = this._tlBar();
      if (bar) {
        bar.classList.remove("pb-tl-select-dragging");
        bar.classList.toggle("pb-tl-ctrl-hover", Boolean(e?.ctrlKey));
      }
    };
    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("mouseup",   this._onMouseUp);
  }

  _dayPctFromEvent(e) {
    const bar = this._tlBar();
    if (!bar || !this._dayStart) return null;
    const rect   = bar.getBoundingClientRect();
    const barPct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const { start: vs, end: ve } = this._visWindow();
    return vs + barPct * (ve - vs);
  }

  _handleTimelineInteraction(e) {
    const dayPct = this._dayPctFromEvent(e);
    if (dayPct == null) return;
    this._loopRange = null; // seek manual — sale de cualquier bucle activo
    this._setCursor(dayPct);
    this._seekToTime(new Date(this._dayStart.getTime() + dayPct * DAY_MS));
  }

  // Ctrl + arrastrar sobre la barra = dibujar el rango In/Out a mano, en
  // vez de marcarlo con las teclas I/O (ver _handleKeyDown). El punto
  // donde se apretó el botón queda fijo como ancla; el otro extremo sigue
  // al cursor mientras se arrastra, así que el rango se puede dibujar en
  // cualquier dirección. No mueve el video — solo actualiza la selección.
  _updateRangeDrag(e) {
    if (this._selectAnchor == null) return;
    const dayPct = this._dayPctFromEvent(e);
    if (dayPct == null) return;

    const t = new Date(this._dayStart.getTime() + dayPct * DAY_MS);
    const anchor = new Date(this._dayStart.getTime() + this._selectAnchor * DAY_MS);

    if (t < anchor) {
      this._inPoint  = t;
      this._outPoint = anchor;
    } else {
      this._inPoint  = anchor;
      this._outPoint = t;
    }
    this._loopRange = null;

    this._setCursor(dayPct);
    this._renderTimeline();
    this._updateExportPanel();
  }

  _seekToTime(targetDate) {
    const clip = this._clips.find(c =>
      new Date(c.clip_from) <= targetDate && targetDate <= new Date(c.clip_to)
    );
    if (!clip) {
      this._showNoSignal(targetDate);
      return;
    }
    const idx    = this._clips.indexOf(clip);
    const offset = Math.max(0, (targetDate - new Date(clip.clip_from)) / 1000);
    this._playClip(idx, offset);
  }

  // ── Reproducción ─────────────────────────────────────────────────────────
  async _playClip(idx, seekOffset = 0) {
    const clip = this._clips[idx];
    if (!clip) return;

    const video = this._video();
    if (!video) return;

    // /playback/serve exige Firebase auth y soporta Range requests — el
    // <video> nativo no puede mandar headers custom, así que apunta a un
    // proxy local (ver main/playback/playback-proxy.js) que reenvía el
    // idToken y el header Range. Así el navegador pide por partes en vez de
    // bajar el segmento completo (~150MB) antes de poder reproducir, que es
    // lo que hacía que cambiar de hora tardara varios segundos.
    if (!this._proxy) this._proxy = await window.kvClient?.getPlaybackProxyInfo?.();
    const { port, token } = this._proxy || {};
    if (!port || !token) {
      this._showEmpty("Error: no se pudo iniciar el proxy de reproducción");
      return;
    }
    const src = `http://127.0.0.1:${port}/serve?path=${encodeURIComponent(clip.path)}&token=${token}`;

    // Si es el mismo clip, solo seekar
    if (idx === this._activeClipIdx && video.src === src) {
      video.currentTime = seekOffset;
      video.play().catch(() => {});
      return;
    }

    this._activeClipIdx = idx;
    this._stopSkip();
    this._showVideo();

    try {
      video.src = src;
      video.load();
      // Seek después de que el video cargue suficiente metadata
      video.addEventListener("loadedmetadata", () => {
        if (seekOffset > 0) video.currentTime = seekOffset;
        // Re-aplicar velocidad actual (nativa o frame-skip)
        this._setSpeed(this._currentSpeed);
      }, { once: true });

      this._updateNavBtns();
      this._updateCtrlInfo(clip);
      this._updatePlayBtn(false);

      // Avanzar al siguiente clip al terminar — salvo que haya un bucle
      // activo (rango In/Out), en cuyo caso vuelve al inicio del rango.
      video.onended = () => {
        if (this._loopRange) { this._seekToTime(this._loopRange.start); return; }
        if (idx < this._clips.length - 1) this._playClip(idx + 1, 0);
      };

      // Actualizar cursor con el tiempo del video, y cerrar el bucle si
      // se pasó del punto Out marcado.
      video.ontimeupdate = () => {
        const clipFrom = new Date(clip.clip_from);
        const current  = new Date(clipFrom.getTime() + video.currentTime * 1000);
        const pct = pctOfDay(current, this._dayStart);
        this._setCursor(pct);

        if (this._loopRange && current >= this._loopRange.end) {
          this._seekToTime(this._loopRange.start);
        }
      };
    } catch (err) {
      this._showEmpty(`Error: ${err.message}`);
    }
  }

  // ── Estado visual ─────────────────────────────────────────────────────────
  _showEmpty(msg = null) {
    const v  = this._video();
    const em = this._$("pb-empty");
    const ns = this._$("pb-nosignal");
    if (v)  { v.classList.remove("visible"); v.pause(); }
    if (ns) ns.classList.remove("visible");
    if (em) {
      em.classList.add("visible");
      if (msg) em.querySelector(".pb-empty-text").textContent = msg;
    }
  }

  _showVideo() {
    const v  = this._video();
    const em = this._$("pb-empty");
    const ns = this._$("pb-nosignal");
    if (em) em.classList.remove("visible");
    if (ns) ns.classList.remove("visible");
    if (v)  v.classList.add("visible");
  }

  _showNoSignal(date) {
    const v  = this._video();
    const em = this._$("pb-empty");
    const ns = this._$("pb-nosignal");
    if (v)  { v.classList.remove("visible"); v.pause(); }
    if (em) em.classList.remove("visible");
    if (ns) {
      ns.classList.add("visible");
      const t = ns.querySelector("#pb-nosignal-time");
      if (t) t.textContent = fmtHMS(date);
    }
  }
}
