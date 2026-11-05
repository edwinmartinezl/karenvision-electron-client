// Extracción semántica por canal — SEM.EXTRACT
// GET/POST /semantic/{extract,list,get} (046-050) — reproducción vía el
// mismo proxy autenticado local que ya usa Playback (main/playback/
// playback-proxy.js, extendido en colaboracion/053 para servir también
// /semantic/serve, no solo /playback/serve).

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function fmtTs(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString([], { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// El backend calcula el costo del análisis en USD (gemini_config.py,
// [[058]]) — esto es solo para MOSTRÁRSELO al usuario en pesos dominicanos,
// no cambia nada del cálculo real ni de lo que se guarda en la DB. Tasa de
// referencia aproximada, no hay una fuente de tipo de cambio en vivo
// conectada en este cliente — ajustar acá si hace falta más precisión.
const USD_TO_DOP_RATE = 60;

function fmtDop(usd) {
  if (typeof usd !== "number" || Number.isNaN(usd)) return "—";
  return `RD$${(usd * USD_TO_DOP_RATE).toFixed(2)}`;
}

// ── Días grabados + barra de 24h ──────────────────────────────────────────
// Misma técnica que renderer/components/playback/playback.js: segmentos
// como % left/width sobre un día de 24h, clips contiguos (gap <
// RUN_MERGE_EPSILON_MS) fusionados en una sola franja visual. Acá no hay
// zoom/pan (siempre se ve el día completo) así que el cálculo se simplifica
// bastante respecto al de Playback.
const DAY_MS = 86_400_000;
const RUN_MERGE_EPSILON_MS = 3000;
const MONTHS_SHORT = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const DAYS_SHORT = ["dom","lun","mar","mié","jue","vie","sáb"];

function fmt2(n) { return String(Math.floor(n)).padStart(2, "0"); }

// YYYY-MM-DD en horario local (no UTC) — coherente con cómo _dayStart ancla
// la barra (medianoche local), para que "qué día tiene grabación" y "qué se
// ve en la barra de ese día" nunca queden desalineados.
function fmtLocalDate(d) {
  return `${d.getFullYear()}-${fmt2(d.getMonth() + 1)}-${fmt2(d.getDate())}`;
}

function fmtChipDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAYS_SHORT[date.getDay()]} ${d} ${MONTHS_SHORT[m - 1]}`;
}

const STATUS_LABEL = { pending: "Pendiente", done: "Lista", failed: "Falló" };

// El backend (coredb.py/engine/semantic_extractor.py, 046-047) devuelve
// mensajes de error en inglés y en texto plano — se reconocen los dos
// patrones más comunes/accionables para el usuario; cualquier otro
// mensaje (p.ej. el stderr crudo de un fallo de ffmpeg) se muestra tal
// cual, truncado si es muy largo.
const RANGE_EXCEEDS_RE = /^range exceeds MAX_EXTRACTION_SECONDS \((\d+)\)$/;
const NO_MATERIAL_RE = /^no recording material for channel (\d+) in requested range$/;
const MAX_ERROR_LEN = 300;

function humanizeSemanticError(msg) {
  const text = String(msg || "").trim();
  const rangeMatch = text.match(RANGE_EXCEEDS_RE);
  if (rangeMatch) return `El rango pedido supera el máximo permitido de ${rangeMatch[1]} segundos.`;
  const noMaterialMatch = text.match(NO_MATERIAL_RE);
  if (noMaterialMatch) return `No hay grabación disponible para el canal ${noMaterialMatch[1]} en el rango indicado.`;
  if (!text) return "Ocurrió un error inesperado.";
  return text.length > MAX_ERROR_LEN ? text.slice(0, MAX_ERROR_LEN) + "…" : text;
}

// Errores de la sección "Analizar" (Agente Karen / Gemini por debajo, ver
// [[062]]) — a diferencia de humanizeSemanticError de arriba (que sí
// muestra mensajes no reconocidos tal cual, porque los de extracción/ffmpeg
// nunca mencionan un proveedor externo), acá NO se puede confiar en que un
// mensaje futuro del SDK no diga "Gemini"/"Google" en el texto crudo. Por
// eso el criterio es al revés: se reconoce un patrón puntual (falta de
// configuración) y CUALQUIER otro mensaje —conocido o no— cae a un
// genérico neutro. El string original del backend nunca se muestra en esta
// sección, punto.
const KAREN_UNAVAILABLE_RE = /gemini|google|api\s*key/i;

function humanizeKarenError(msg) {
  const text = String(msg || "").trim();
  if (KAREN_UNAVAILABLE_RE.test(text)) {
    return "El Agente Karen no está disponible todavía. Contactá al administrador del sistema.";
  }
  return "No se pudo completar el análisis. Intenta de nuevo.";
}

export class SemanticPanel {
  constructor(hostEl, api, onToast) {
    this._el = hostEl;
    this._api = api;
    this._onToast = typeof onToast === "function" ? onToast : null;
    this._root = null;
    this._busy = false;

    this._channels = [];
    this._selectedChannel = null;
    this._extractions = [];
    this._expandedId = null;
    this._proxy = null;

    // Días grabados + barra de 24h (ver "Días grabados" en _renderPanel)
    this._channelSegments = [];  // segmentos crudos de /timeline/show para el canal actual
    this._recordedDays = [];     // [{date:"YYYY-MM-DD", segments:[...]}] más reciente primero
    this._selectedDay = null;    // "YYYY-MM-DD" o null
    this._dayStart = null;       // Date — medianoche local de _selectedDay
    this._tlDragCleanup = null;  // función para desatar los listeners de un arrastre en curso

    // Valores del formulario "Nueva extracción" — se guardan acá (no solo en
    // el DOM) porque _renderPanel() reconstruye los <input> desde cero en
    // cada re-render (cambio de canal, de día, nueva extracción, etc.); sin
    // esto, seleccionar un día borraría lo que el usuario ya había
    // arrastrado o tipeado.
    this._formFrom = "";
    this._formTo = "";
    this._formInterval = "1";

    // Análisis con el Agente Karen por extracción (ver "Analizar" en la
    // tabla, [[067]]) — solo una fila puede tener la sección abierta a la
    // vez, por eso es un id escalar y no un mapa por extracción.
    this._analyzeExtractionId = null;
    this._analyzeBusyEstimate = false;
    this._analyzeEstimate = null;
    this._analyzeEstimateError = null;
    this._analyzePromptText = "";
    this._analyzeBusy = false;
    this._analyzeError = null;
    this._analyzeLastResult = null;
    this._analyzeHistory = [];
  }

  // Alerta flotante centrada — mismo mecanismo que usa el resto de la app
  // para avisos de sistema (ToastStack, montado por app-controller.js).
  _toast(msg, type = "error") {
    this._onToast?.(msg, { type });
  }

  mount() {
    this._root = document.createElement("div");
    this._root.className = "sem-root";
    this._root.innerHTML = `
      <div class="sem-header">
        <div class="sem-header-left">
          <span class="sem-header-icon">🔍</span>
          <div>
            <div class="sem-title">Búsqueda Semántica</div>
            <div class="sem-badge">SEM.EXTRACT</div>
          </div>
        </div>
      </div>

      <div class="sem-layout">
        <div class="sem-sidebar">
          <div class="sem-sidebar-title">Canal</div>
          <input type="text" class="sem-search" id="sem-search" placeholder="Buscar por número, nombre o IP…" autocomplete="off">
          <div class="sem-channel-list" id="sem-channel-list">
            <div class="sem-empty-hint">Cargando cámaras…</div>
          </div>
        </div>

        <div class="sem-panel" id="sem-panel">
          <div class="sem-empty-state">
            <div class="sem-empty-icon">🔍</div>
            <div class="sem-empty-text">Selecciona un canal para ver sus extracciones.</div>
          </div>
        </div>
      </div>
    `;
    this._el.appendChild(this._root);

    this._root.querySelector("#sem-search").addEventListener("input", () => this._renderChannelList());

    void this._bootstrap();
  }

  destroy() {
    this._teardownDayBarDrag();
    this._root?.remove();
    this._root = null;
  }

  // ── Carga inicial ───────────────────────────────────────────────────────

  async _bootstrap() {
    this._channels = await this._loadChannels();
    if (!this._root) return; // destruido durante la carga
    this._renderChannelList();
  }

  async _loadChannels() {
    try {
      const res = await this._api({ method: "GET", path: "/camera/list" });
      return (res?.ok && Array.isArray(res.data)) ? res.data : [];
    } catch (_) {
      return [];
    }
  }

  // ── Selector de canal ────────────────────────────────────────────────────
  // Mismo buscador/filtro en memoria que record-schedule.js — sin badge de
  // "configurado" (acá cada extracción es un evento puntual, no un estado
  // persistente del canal).

  _renderChannelList() {
    const wrap = this._root?.querySelector("#sem-channel-list");
    if (!wrap) return;

    const q = (this._root.querySelector("#sem-search")?.value || "").trim().toLowerCase();
    const filtered = !q ? this._channels : this._channels.filter(ch => {
      const hay = `${ch.channel} ${ch.name || ""} ${ch.ip || ""}`.toLowerCase();
      return hay.includes(q);
    });

    if (!filtered.length) {
      wrap.innerHTML = `<div class="sem-empty-hint">${this._channels.length ? "Sin resultados" : "Sin cámaras registradas"}</div>`;
      return;
    }

    wrap.innerHTML = filtered.map(ch => {
      const channel = Number(ch.channel);
      const active = this._selectedChannel === channel;
      return `
        <div class="sem-ch-row${active ? " active" : ""}" data-channel="${esc(String(channel))}">
          <span class="sem-ch-badge">CH${esc(String(channel))}</span>
          <div class="sem-ch-main">
            <div class="sem-ch-name">${esc(ch.name || "Sin nombre")}</div>
            <div class="sem-ch-ip">${esc(ch.ip || "")}</div>
          </div>
        </div>
      `;
    }).join("");

    wrap.querySelectorAll(".sem-ch-row").forEach(row => {
      row.addEventListener("click", () => this._selectChannel(Number(row.dataset.channel)));
    });
  }

  async _selectChannel(channel) {
    if (this._selectedChannel === channel) return;
    this._selectedChannel = channel;
    this._expandedId = null;
    this._selectedDay = null;
    this._dayStart = null;
    this._channelSegments = [];
    this._recordedDays = [];
    this._formFrom = "";
    this._formTo = "";
    this._formInterval = "1";
    this._resetAnalyzeState();
    this._renderChannelList();
    await this._loadChannelData(channel);
  }

  // Cierra la sección de análisis abierta (si había una) y limpia todo su
  // estado — usado al cambiar de canal, volver a la lista de canales, o
  // cerrar la sección a mano (_toggleAnalyze).
  _resetAnalyzeState() {
    this._analyzeExtractionId = null;
    this._analyzeBusyEstimate = false;
    this._analyzeEstimate = null;
    this._analyzeEstimateError = null;
    this._analyzePromptText = "";
    this._analyzeBusy = false;
    this._analyzeError = null;
    this._analyzeLastResult = null;
    this._analyzeHistory = [];
  }

  // Carga inicial al elegir un canal: extracciones (/semantic/list) y
  // timeline (/timeline/show, para "Días grabados" + la barra) en paralelo.
  async _loadChannelData(channel) {
    const panel = this._root?.querySelector("#sem-panel");
    if (!panel) return;
    panel.innerHTML = '<div class="sem-loading">Cargando extracciones…</div>';

    const [extractionsRes, timelineRes] = await Promise.all([
      this._api({ method: "GET", path: "/semantic/list", query: { channel } }),
      // full=false (default) + channel: la única forma de que /timeline/show
      // devuelva los segmentos de ESTE canal — full=true ignora "channel" y
      // solo trae un resumen agregado de todos los canales (ver
      // timeline_service.show_timeline), no sirve para pintar la barra.
      this._api({ method: "GET", path: "/timeline/show", query: { channel } }),
    ]);

    // El usuario pudo haber elegido otro canal mientras esto cargaba.
    if (!this._root || this._selectedChannel !== channel) return;

    this._extractions = extractionsRes?.ok ? (extractionsRes.data?.extractions || []) : [];

    const segments = (timelineRes?.ok && Array.isArray(timelineRes.data?.timeline?.segments))
      ? timelineRes.data.timeline.segments
      : [];
    this._channelSegments = segments;
    this._recordedDays = this._groupSegmentsByDay(segments);
    // Igual que Playback ("abrir hoy por defecto"): si hay días con
    // grabación, se abre el más reciente solo, sin esperar un click extra.
    if (this._recordedDays.length) this._selectDayInternal(this._recordedDays[0].date);

    this._renderPanel();
  }

  // Recarga solo la tabla de extracciones (usado tras crear una nueva) —
  // sin el parpadeo de "Cargando…" de _loadChannelData y sin volver a pedir
  // /timeline/show (no cambió: crear una extracción no toca la grabación).
  async _reloadExtractions() {
    const channel = this._selectedChannel;
    const res = await this._api({ method: "GET", path: "/semantic/list", query: { channel } });
    if (!this._root || this._selectedChannel !== channel) return;
    this._extractions = res?.ok ? (res.data?.extractions || []) : [];
    this._renderPanel();
  }

  // Agrupa los segmentos (ya vienen ordenados por start_ts ASC desde el
  // backend, ver timeline_segments) por día calendario LOCAL de su inicio.
  _groupSegmentsByDay(segments) {
    const byDay = new Map();
    for (const seg of segments) {
      const start = new Date(seg.start);
      if (Number.isNaN(start.getTime())) continue;
      const key = fmtLocalDate(start);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(seg);
    }
    return [...byDay.keys()]
      .sort((a, b) => b.localeCompare(a))
      .map(date => ({ date, segments: byDay.get(date) }));
  }

  // Selección de día sin re-render — usado desde _loadChannelData para fijar
  // el día por defecto antes del primer _renderPanel().
  _selectDayInternal(dateStr) {
    this._selectedDay = dateStr;
    const [y, m, d] = dateStr.split("-").map(Number);
    this._dayStart = new Date(y, m - 1, d, 0, 0, 0);
  }

  _selectDay(dateStr) {
    if (this._selectedDay === dateStr) return;
    this._selectDayInternal(dateStr);
    this._renderPanel();
  }

  // ── Panel de detalle ─────────────────────────────────────────────────────

  _renderPanel() {
    const panel = this._root?.querySelector("#sem-panel");
    if (!panel) return;

    // Cancela cualquier arrastre en curso sobre la barra del render
    // anterior — panel.innerHTML de abajo destruye ese DOM, así que los
    // listeners de document (mousemove/mouseup) del arrastre quedarían
    // huérfanos si no se limpian acá.
    this._teardownDayBarDrag();

    const channel = this._selectedChannel;
    const hasExtractions = this._extractions.length > 0;

    panel.innerHTML = `
      <div class="sem-panel-header">
        <div class="sem-panel-header-left">
          <button class="sem-back-btn" id="sem-back-btn" type="button">‹ Volver a canales</button>
          <div class="sem-panel-title">Canal ${esc(String(channel))}</div>
        </div>
      </div>

      ${this._recordedDaysHtml()}

      <div class="sem-form-wrap">
        <div class="sem-form-title">Nueva extracción</div>
        <div class="sem-form-row">
          <div class="sem-form-field">
            <label for="sem-from">Inicio</label>
            <input type="datetime-local" id="sem-from" step="1" value="${esc(this._formFrom)}">
          </div>
          <div class="sem-form-field">
            <label for="sem-to">Fin</label>
            <input type="datetime-local" id="sem-to" step="1" value="${esc(this._formTo)}">
          </div>
          <div class="sem-form-field sem-form-field-narrow">
            <label for="sem-interval">Intervalo (s)</label>
            <input type="number" id="sem-interval" value="${esc(this._formInterval)}" min="0.1" step="0.1">
          </div>
          <button class="sem-btn-primary" id="sem-extract-btn" type="button">Extraer</button>
        </div>
        <div class="sem-form-feedback" id="sem-form-feedback"></div>
      </div>

      <div class="sem-extractions-wrap">
        <div class="sem-form-title">Extracciones</div>
        ${hasExtractions ? this._tableHtml() : `<div class="sem-empty-channel">Este canal no tiene extracciones todavía.</div>`}
      </div>
    `;

    panel.querySelector("#sem-back-btn")?.addEventListener("click", () => this._backToChannels());
    panel.querySelector("#sem-extract-btn")?.addEventListener("click", () => this._extract());
    panel.querySelectorAll(".sem-td-play").forEach(btn => {
      btn.addEventListener("click", () => this._togglePlay(Number(btn.dataset.id)));
    });
    panel.querySelectorAll(".sem-td-analyze").forEach(btn => {
      btn.addEventListener("click", () => this._toggleAnalyze(Number(btn.dataset.id)));
    });

    const analyzePromptEl = panel.querySelector("#sem-analyze-prompt");
    const analyzeBtn = panel.querySelector("#sem-analyze-btn");
    const updateAnalyzeBtnState = () => {
      if (!analyzeBtn) return;
      analyzeBtn.disabled = this._analyzeBusy || !this._analyzeEstimate || !analyzePromptEl.value.trim();
    };
    analyzePromptEl?.addEventListener("input", () => {
      this._analyzePromptText = analyzePromptEl.value;
      updateAnalyzeBtnState();
    });
    updateAnalyzeBtnState();
    analyzeBtn?.addEventListener("click", () => this._runAnalyze());

    const fromEl = panel.querySelector("#sem-from");
    const toEl = panel.querySelector("#sem-to");
    const intervalEl = panel.querySelector("#sem-interval");
    fromEl?.addEventListener("input", () => { this._formFrom = fromEl.value; });
    toEl?.addEventListener("input", () => { this._formTo = toEl.value; });
    intervalEl?.addEventListener("input", () => { this._formInterval = intervalEl.value; });

    panel.querySelectorAll(".sem-day-chip").forEach(chip => {
      chip.addEventListener("click", () => this._selectDay(chip.dataset.date));
    });
    this._bindDayBarEvents();
    this._renderDayBar();
  }

  // Deselecciona el canal y vuelve al estado inicial del panel (mismo
  // markup que al montar) — sin residuos del canal anterior (extracciones,
  // fila expandida, días grabados, formulario).
  _backToChannels() {
    this._teardownDayBarDrag();
    this._selectedChannel = null;
    this._extractions = [];
    this._expandedId = null;
    this._selectedDay = null;
    this._dayStart = null;
    this._channelSegments = [];
    this._recordedDays = [];
    this._formFrom = "";
    this._formTo = "";
    this._formInterval = "1";
    this._resetAnalyzeState();
    this._renderChannelList();
    this._renderEmptyPanel();
  }

  _renderEmptyPanel() {
    const panel = this._root?.querySelector("#sem-panel");
    if (!panel) return;
    panel.innerHTML = `
      <div class="sem-empty-state">
        <div class="sem-empty-icon">🔍</div>
        <div class="sem-empty-text">Selecciona un canal para ver sus extracciones.</div>
      </div>
    `;
  }

  // ── Días grabados + barra de 24h ─────────────────────────────────────────
  // Ver qué hay grabado antes de elegir el rango a mano — sin esto, el
  // usuario tenía que adivinar horarios a ciegas en el formulario.

  _recordedDaysHtml() {
    if (!this._recordedDays.length) return "";
    const chips = this._recordedDays.map(d => `
      <button type="button" class="sem-day-chip${d.date === this._selectedDay ? " active" : ""}" data-date="${esc(d.date)}">${esc(fmtChipDate(d.date))}</button>
    `).join("");

    return `
      <div class="sem-days-wrap">
        <div class="sem-days-title">Días grabados</div>
        <div class="sem-days-list" id="sem-days-list">${chips}</div>
        ${this._selectedDay ? `
          <div class="sem-tl-wrap">
            <div class="sem-tl-bar-wrap" id="sem-tl-bar-wrap">
              <div class="sem-tl-bar" id="sem-tl-bar"></div>
            </div>
            <div class="sem-tl-hours">
              ${[0,2,4,6,8,10,12,14,16,18,20,22,24].map(h => `<span>${fmt2(h)}:00</span>`).join("")}
            </div>
            <div class="sem-tl-hint">Click fija el inicio · arrastrar selecciona un rango</div>
          </div>
        ` : ""}
      </div>
    `;
  }

  // Fusiona en franjas continuas los segmentos que caen (aunque sea
  // parcialmente) dentro de [dayStart, dayEnd) — mismo criterio de
  // _mergedRecordedRuns() en playback.js (gap ≤ RUN_MERGE_EPSILON_MS se
  // considera grabación continua, no un corte real).
  _mergedRunsForDay(dayStart, dayEnd) {
    const runs = [];
    for (const seg of this._channelSegments) {
      const s = new Date(seg.start);
      const e = new Date(seg.end);
      if (e <= dayStart || s >= dayEnd) continue;
      const last = runs[runs.length - 1];
      if (last && s - last.end <= RUN_MERGE_EPSILON_MS) {
        if (e > last.end) last.end = e;
      } else {
        runs.push({ start: s, end: e });
      }
    }
    return runs;
  }

  _renderDayBar() {
    const bar = this._root?.querySelector("#sem-tl-bar");
    if (!bar || !this._dayStart) return;
    bar.innerHTML = "";

    const dayStart = this._dayStart;
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    this._mergedRunsForDay(dayStart, dayEnd).forEach(run => {
      const s = Math.max(run.start.getTime(), dayStart.getTime());
      const e = Math.min(run.end.getTime(), dayEnd.getTime());
      if (s >= e) return;
      const left = ((s - dayStart.getTime()) / DAY_MS) * 100;
      const width = ((e - s) / DAY_MS) * 100;
      const seg = document.createElement("div");
      seg.className = "sem-tl-recorded";
      seg.style.left = left.toFixed(3) + "%";
      seg.style.width = Math.max(0.1, width).toFixed(3) + "%";
      seg.title = `${fmt2(run.start.getHours())}:${fmt2(run.start.getMinutes())} → ${fmt2(run.end.getHours())}:${fmt2(run.end.getMinutes())}`;
      bar.appendChild(seg);
    });
  }

  // Dibuja el marcador (click simple) o la franja de selección (arrastre en
  // curso o recién soltado) — mismas clases .sem-tl-point/.sem-tl-selection
  // usadas tanto durante el drag como para el resultado final.
  _renderDayBarMark(startPct, endPct) {
    const bar = this._root?.querySelector("#sem-tl-bar");
    if (!bar) return;
    bar.querySelectorAll(".sem-tl-selection, .sem-tl-point").forEach(el => el.remove());

    const lo = Math.min(startPct, endPct);
    const hi = Math.max(startPct, endPct);

    if (hi - lo < 0.001) {
      const mark = document.createElement("div");
      mark.className = "sem-tl-point";
      mark.style.left = (lo * 100).toFixed(3) + "%";
      bar.appendChild(mark);
      return;
    }

    const sel = document.createElement("div");
    sel.className = "sem-tl-selection";
    sel.style.left = (lo * 100).toFixed(3) + "%";
    sel.style.width = ((hi - lo) * 100).toFixed(3) + "%";
    bar.appendChild(sel);
  }

  _teardownDayBarDrag() {
    if (this._tlDragCleanup) {
      this._tlDragCleanup();
      this._tlDragCleanup = null;
    }
  }

  _bindDayBarEvents() {
    const bar = this._root?.querySelector("#sem-tl-bar");
    if (!bar || !this._dayStart) return;

    const pctFromEvent = (e) => {
      const rect = bar.getBoundingClientRect();
      if (!rect.width) return 0;
      return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    };

    const onMouseDown = (e) => {
      e.preventDefault();
      const startPct = pctFromEvent(e);
      let moved = false;
      this._renderDayBarMark(startPct, startPct);

      const onMouseMove = (ev) => {
        const pct = pctFromEvent(ev);
        if (Math.abs(pct - startPct) > 0.002) moved = true;
        this._renderDayBarMark(startPct, pct);
      };
      const onMouseUp = (ev) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        this._tlDragCleanup = null;
        const endPct = pctFromEvent(ev);
        // Repinta con la posición final exacta — el último mousemove antes
        // de soltar pudo quedar unos px atrás de este mouseup.
        this._renderDayBarMark(startPct, endPct);
        if (moved) {
          this._applyDayBarRange(startPct, endPct);
        } else {
          this._applyDayBarPoint(startPct);
        }
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      this._tlDragCleanup = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
    };

    bar.addEventListener("mousedown", onMouseDown);
  }

  // Click simple: fija el inicio en ese punto sin tocar "Fin" — dejarlo
  // como estaba evita crear un rango de duración cero que la validación de
  // _extract() rechazaría igual.
  _applyDayBarPoint(pct) {
    this._fillDatetimeInput("from", this._timeFromDayPct(pct));
  }

  _applyDayBarRange(startPct, endPct) {
    const lo = Math.min(startPct, endPct);
    const hi = Math.max(startPct, endPct);
    this._fillDatetimeInput("from", this._timeFromDayPct(lo));
    this._fillDatetimeInput("to", this._timeFromDayPct(hi));
  }

  // Fracción (0..1) del día → "HH:MM", con resolución de minuto (no de
  // segundo, a diferencia de Playback) — pedido así en la tarea. Se acota a
  // 23:59 para no tener que resolver el cruce de medianoche acá: cruzar de
  // día es un caso que la tarea deja para edición manual del input "Fin".
  _timeFromDayPct(pct) {
    const totalMinutes = Math.min(23 * 60 + 59, Math.max(0, Math.round(pct * 24 * 60)));
    return `${fmt2(Math.floor(totalMinutes / 60))}:${fmt2(totalMinutes % 60)}`;
  }

  _fillDatetimeInput(which, timeStr) {
    if (!this._selectedDay) return;
    const value = `${this._selectedDay}T${timeStr}`;
    if (which === "from") this._formFrom = value; else this._formTo = value;
    const input = this._root?.querySelector(which === "from" ? "#sem-from" : "#sem-to");
    if (input) input.value = value;
  }

  _tableHtml() {
    const rows = this._extractions.map(ex => {
      const isExpanded = this._expandedId === ex.id;
      const isAnalyzeExpanded = this._analyzeExtractionId === ex.id;
      const canPlay = ex.status === "done";
      return `
        <div class="sem-table-row">
          <span class="sem-td sem-td-id">#${esc(String(ex.id))}</span>
          <span class="sem-td sem-td-range">${esc(fmtTs(ex.from_ts))} – ${esc(fmtTs(ex.to_ts))}</span>
          <span class="sem-td sem-td-interval">${esc(String(ex.interval_seconds))}s</span>
          <span class="sem-td sem-td-status sem-status-${esc(ex.status)}">${esc(STATUS_LABEL[ex.status] || ex.status)}</span>
          <span class="sem-td sem-td-frames">${ex.frame_count != null ? esc(String(ex.frame_count)) : "—"}</span>
          <span class="sem-td sem-td-size">${ex.size_bytes != null ? esc(fmtBytes(ex.size_bytes)) : "—"}</span>
          <span class="sem-td sem-td-action">${canPlay ? `
            <button class="sem-td-play" data-id="${esc(String(ex.id))}" type="button">${isExpanded ? "Ocultar" : "▶ Reproducir"}</button>
            <button class="sem-td-analyze" data-id="${esc(String(ex.id))}" type="button">${isAnalyzeExpanded ? "Cerrar" : "🧠 Analizar"}</button>
          ` : ""}</span>
        </div>
        ${ex.status === "failed" ? `<div class="sem-row-error">${esc(humanizeSemanticError(ex.error_message))}</div>` : ""}
        ${isExpanded ? `<div class="sem-row-video"><video controls autoplay src="${esc(this._videoSrc(ex.id))}"></video></div>` : ""}
        ${this._analyzeRowHtml(ex)}
      `;
    }).join("");

    return `
      <div class="sem-table">
        <div class="sem-table-header">
          <span class="sem-td sem-td-id">ID</span>
          <span class="sem-td sem-td-range">Rango</span>
          <span class="sem-td sem-td-interval">Intervalo</span>
          <span class="sem-td sem-td-status">Estado</span>
          <span class="sem-td sem-td-frames">Frames</span>
          <span class="sem-td sem-td-size">Tamaño</span>
          <span class="sem-td sem-td-action"></span>
        </div>
        ${rows}
      </div>
    `;
  }

  // ── Formulario: nueva extracción ─────────────────────────────────────────

  _setFormFeedback(msg, isErr) {
    const fb = this._root?.querySelector("#sem-form-feedback");
    if (!fb) return;
    fb.textContent = msg || "";
    fb.className = "sem-form-feedback" + (isErr ? " err" : "");
  }

  async _extract() {
    if (this._busy) return;
    const panel = this._root?.querySelector("#sem-panel");
    if (!panel) return;

    const fromRaw = panel.querySelector("#sem-from")?.value;
    const toRaw = panel.querySelector("#sem-to")?.value;
    const intervalRaw = panel.querySelector("#sem-interval")?.value;

    if (!fromRaw || !toRaw) { this._setFormFeedback("Indica inicio y fin del rango.", true); return; }

    const fromDate = new Date(fromRaw);
    const toDate = new Date(toRaw);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      this._setFormFeedback("Fecha/hora inválida.", true);
      return;
    }
    if (toDate <= fromDate) { this._setFormFeedback("El fin debe ser posterior al inicio.", true); return; }

    const interval = Number(intervalRaw);
    if (!Number.isFinite(interval) || interval <= 0) {
      this._setFormFeedback("El intervalo debe ser mayor a 0.", true);
      return;
    }

    this._busy = true;
    const btn = panel.querySelector("#sem-extract-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Extrayendo…"; }
    this._setFormFeedback("", false);

    // Request potencialmente larga/bloqueante (ffmpeg real del lado del
    // servidor, ver [[047]]) — timeoutMs alto en vez de 0 para no colgar
    // la UI indefinidamente si el servidor realmente no responde más
    // (colaboracion/071; antes este comentario asumía "sin timeout" pero
    // apiRequest() sí aplicaba el default de 8s igual).
    const channel = this._selectedChannel;
    const res = await this._api({
      method: "POST",
      path: "/semantic/extract",
      body: {
        channel,
        from_ts: fromDate.toISOString(),
        to_ts: toDate.toISOString(),
        interval_seconds: interval,
      },
      timeoutMs: 300000,
    });

    if (!this._root || this._selectedChannel !== channel) { this._busy = false; return; }

    if (!res?.ok) {
      this._busy = false;
      const btnAfter = this._root.querySelector("#sem-extract-btn");
      if (btnAfter) { btnAfter.disabled = false; btnAfter.textContent = "Extraer"; }
      const message = humanizeSemanticError(res?.data?.message || res?.data?.detail || "No se pudo extraer.");
      this._setFormFeedback(message, true);
      this._toast(message, "error");
      await this._reloadExtractions();
      return;
    }

    // /semantic/extract responde de inmediato con {id, status:"pending"} —
    // ffmpeg real corre en background del lado del servidor
    // (colaboracion/077). Se sondea /semantic/get hasta que termine, en
    // vez de asumir que la respuesta inicial ya trae el resultado final
    // (antes SÍ lo traía — este bug real se detectó al agregar la barra
    // de progreso del CLI y notar que la UI ya asumía mal lo mismo).
    const final = await this._pollExtraction(res.data.id, channel);

    this._busy = false;
    if (!this._root || this._selectedChannel !== channel) return;

    const btnAfter = this._root.querySelector("#sem-extract-btn");
    if (btnAfter) { btnAfter.disabled = false; btnAfter.textContent = "Extraer"; }

    if (!final || final.status === "failed") {
      const message = humanizeSemanticError(final?.error_message || "La extracción falló.");
      this._setFormFeedback(message, true);
      this._toast(message, "error");
    } else {
      this._setFormFeedback("Extracción completada.", false);
    }

    await this._reloadExtractions();
  }

  // Sondea /semantic/get cada 1s y actualiza el texto del botón con el %
  // real (progress_pct, ver coredb.py) hasta que status sea done/failed.
  // Devuelve el registro final, o null si el panel se destruyó/cambió de
  // canal mientras esperaba (no queda nada que actualizar en ese caso).
  async _pollExtraction(extractionId, channel) {
    const btn = this._root?.querySelector("#sem-extract-btn");
    while (true) {
      if (!this._root || this._selectedChannel !== channel) return null;

      const res = await this._api({ method: "GET", path: "/semantic/get", query: { id: extractionId } });
      if (!this._root || this._selectedChannel !== channel) return null;

      if (!res?.ok) return null;
      const record = res.data;
      if (record.status === "done" || record.status === "failed") return record;

      if (btn) {
        const pct = Math.max(0, Math.min(100, Math.round(record.progress_pct || 0)));
        btn.textContent = `Extrayendo… ${pct}%`;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // ── Reproducción ─────────────────────────────────────────────────────────
  // /semantic/serve exige Firebase auth y soporta Range requests, igual que
  // /playback/serve — el <video> nativo no puede mandar headers custom, así
  // que reusa el mismo proxy local autenticado que ya usa Playback (ver
  // main/playback/playback-proxy.js).

  async _togglePlay(id) {
    if (this._expandedId === id) {
      this._expandedId = null;
      this._renderPanel();
      return;
    }

    if (!this._proxy) this._proxy = await window.kvClient?.getPlaybackProxyInfo?.();
    if (!this._proxy?.port || !this._proxy?.token) {
      this._toast("No se pudo iniciar el proxy de reproducción.", "error");
      return;
    }

    this._expandedId = id;
    this._renderPanel();
  }

  _videoSrc(id) {
    const { port, token } = this._proxy || {};
    if (!port || !token) return "";
    return `http://127.0.0.1:${port}/semantic-serve?id=${id}&token=${token}`;
  }

  // ── Análisis con el Agente Karen ─────────────────────────────────────────
  // Extracción + análisis unificados en un solo lugar ([[067]]) — antes
  // vivía como transacción aparte en Comandos ([[066]]), retirada de ahí.
  // "Agente Karen" es el nombre de marca de cara al usuario; el proveedor
  // real (Gemini) y el nombre de modelo que devuelve la API nunca se
  // muestran en ningún label ni en la columna "Modelo" del historial.

  _toggleAnalyze(id) {
    if (this._analyzeExtractionId === id) {
      this._resetAnalyzeState();
      this._renderPanel();
      return;
    }
    this._resetAnalyzeState();
    this._analyzeExtractionId = id;
    this._renderPanel();
    void this._loadAnalyzeEstimate(id);
    void this._loadAnalyzeHistory(id);
  }

  async _loadAnalyzeEstimate(id) {
    this._analyzeBusyEstimate = true;
    this._renderPanel();
    try {
      const res = await this._api({ method: "GET", path: "/semantic/estimate", query: { extraction_id: id } });
      if (this._analyzeExtractionId !== id) return; // se cerró/cambió mientras cargaba
      if (res?.ok) {
        this._analyzeEstimate = res.data;
        this._analyzeEstimateError = null;
      } else {
        this._analyzeEstimate = null;
        this._analyzeEstimateError = "No se pudo calcular el costo estimado.";
      }
    } catch (_) {
      if (this._analyzeExtractionId !== id) return;
      this._analyzeEstimate = null;
      this._analyzeEstimateError = "No se pudo calcular el costo estimado.";
    } finally {
      if (this._analyzeExtractionId === id) {
        this._analyzeBusyEstimate = false;
        this._renderPanel();
      }
    }
  }

  async _loadAnalyzeHistory(id) {
    try {
      const res = await this._api({ method: "GET", path: "/semantic/analyses", query: { extraction_id: id } });
      if (this._analyzeExtractionId !== id) return;
      this._analyzeHistory = (res?.ok && Array.isArray(res.data?.analyses)) ? res.data.analyses : [];
    } catch (_) {
      if (this._analyzeExtractionId !== id) return;
      this._analyzeHistory = [];
    }
    if (this._analyzeExtractionId === id) this._renderPanel();
  }

  // Síncrono/bloqueante, mismo criterio que /extract desde [[049]] — sin
  // versión async en esta tanda.
  async _runAnalyze() {
    if (this._analyzeBusy || this._analyzeExtractionId == null) return;
    const panel = this._root?.querySelector("#sem-panel");
    if (!panel) return;
    const prompt = this._analyzePromptText.trim();
    if (!prompt) return;

    const extractionId = this._analyzeExtractionId;
    this._analyzeBusy = true;
    const btn = panel.querySelector("#sem-analyze-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Consultando…"; }

    // Llamada real y sincronica a Gemini — el default de 8s de
    // apiRequest() la cortaba de este lado mientras el servidor seguía
    // trabajando y terminaba guardando el análisis igual (bug real
    // encontrado en vivo, colaboracion/071).
    let res;
    try {
      res = await this._api({
        method: "POST",
        path: "/semantic/analyze",
        body: { extraction_id: extractionId, prompt },
        timeoutMs: 300000,
      });
    } catch (err) {
      res = { ok: false, data: { message: err?.message || String(err) } };
    }

    this._analyzeBusy = false;
    if (this._analyzeExtractionId !== extractionId) return; // se cerró/cambió mientras corría

    if (!res?.ok) {
      // humanizeKarenError, no humanizeSemanticError — nunca el mensaje
      // crudo acá, puede mencionar Gemini (ver comentario junto a la
      // función).
      const raw = res?.data?.message || res?.data?.detail || res?.data?.error || "";
      const message = humanizeKarenError(raw);
      this._analyzeError = message;
      this._toast(message, "error");
      this._renderPanel();
      await this._loadAnalyzeHistory(extractionId);
      return;
    }

    this._analyzeError = null;
    this._analyzeLastResult = res.data;
    this._renderPanel();
    await this._loadAnalyzeHistory(extractionId);
  }

  _analyzeRowHtml(ex) {
    if (this._analyzeExtractionId !== ex.id) return "";

    const promptDisabled = !this._analyzeEstimate; // se habilita recién con el estimado cargado

    return `
      <div class="sem-row-analyze">
        ${this._analyzeEstimateHtml()}

        <div class="sem-analyze-prompt-wrap">
          <label class="sem-analyze-prompt-label" for="sem-analyze-prompt">Preguntale al Agente Karen sobre este video</label>
          <textarea
            class="sem-analyze-prompt-input"
            id="sem-analyze-prompt"
            rows="2"
            placeholder="Ej: ¿Hay alguna persona en el video? Describí lo que ves."
            ${promptDisabled ? "disabled" : ""}
          >${esc(this._analyzePromptText)}</textarea>
          <div class="sem-analyze-prompt-row">
            <button class="sem-btn-primary" id="sem-analyze-btn" type="button" disabled>Preguntarle al Agente Karen</button>
          </div>
          <div class="sem-analyze-feedback${this._analyzeError ? " err" : ""}">${this._analyzeError ? esc(this._analyzeError) : ""}</div>
        </div>

        ${this._analyzeResultHtml()}
        ${this._analyzeHistoryHtml()}
      </div>
    `;
  }

  _analyzeEstimateHtml() {
    if (this._analyzeBusyEstimate) {
      return `<div class="sem-analyze-block"><div class="sem-analyze-loading">Calculando costo estimado…</div></div>`;
    }
    if (this._analyzeEstimateError) {
      return `<div class="sem-analyze-block"><div class="sem-analyze-est-error">${esc(this._analyzeEstimateError)}</div></div>`;
    }
    if (!this._analyzeEstimate) return "";

    const e = this._analyzeEstimate;
    return `
      <div class="sem-analyze-block">
        <div class="sem-analyze-block-title">Costo estimado del análisis</div>
        <div class="sem-analyze-metric-grid">
          <div class="sem-analyze-metric">
            <div class="sem-analyze-metric-label">Frames</div>
            <div class="sem-analyze-metric-value">${esc(String(e.frame_count))}</div>
          </div>
          <div class="sem-analyze-metric">
            <div class="sem-analyze-metric-label">Tokens estimados</div>
            <div class="sem-analyze-metric-value">${esc(String(e.tokens_input_estimate))}</div>
          </div>
          <div class="sem-analyze-metric">
            <div class="sem-analyze-metric-label">Costo estimado</div>
            <div class="sem-analyze-metric-value">${fmtDop(e.cost_usd_estimate)}</div>
          </div>
          <div class="sem-analyze-metric">
            <div class="sem-analyze-metric-label">Créditos estimados</div>
            <div class="sem-analyze-metric-value">${e.cost_credits_estimate.toFixed(3)}</div>
          </div>
        </div>
      </div>
    `;
  }

  // Debajo del estimado (nunca lo reemplaza) — para comparar de un vistazo.
  _analyzeResultHtml() {
    if (!this._analyzeLastResult) return "";
    const r = this._analyzeLastResult;
    return `
      <div class="sem-analyze-block sem-analyze-result">
        <div class="sem-analyze-block-title">Respuesta del Agente Karen</div>
        <div class="sem-analyze-metric-grid">
          <div class="sem-analyze-metric">
            <div class="sem-analyze-metric-label">Tokens entrada</div>
            <div class="sem-analyze-metric-value">${esc(String(r.tokens_input))}</div>
          </div>
          <div class="sem-analyze-metric">
            <div class="sem-analyze-metric-label">Tokens salida</div>
            <div class="sem-analyze-metric-value">${esc(String(r.tokens_output))}</div>
          </div>
          <div class="sem-analyze-metric">
            <div class="sem-analyze-metric-label">Costo real</div>
            <div class="sem-analyze-metric-value sem-analyze-ok">${fmtDop(r.cost_usd)}</div>
          </div>
          <div class="sem-analyze-metric">
            <div class="sem-analyze-metric-label">Créditos reales</div>
            <div class="sem-analyze-metric-value sem-analyze-ok">${r.cost_credits.toFixed(3)}</div>
          </div>
        </div>
        <div class="sem-analyze-response-text">${esc(r.response_text)}</div>
      </div>
    `;
  }

  _analyzeHistoryHtml() {
    if (!this._analyzeHistory.length) {
      return `
        <div class="sem-analyze-block">
          <div class="sem-analyze-block-title">Consultas anteriores</div>
          <div class="sem-empty-hint">Sin consultas previas para esta extracción.</div>
        </div>
      `;
    }

    // "Modelo" siempre "Agente Karen" acá, sin importar qué string real
    // devuelva el registro (ej. "gemini-3.6-flash") — nunca se imprime el
    // valor real del backend en esta columna.
    const rows = this._analyzeHistory.map(an => `
      <div class="sem-analyze-hist-row">
        <span class="sem-analyze-hist-td sem-status-${esc(an.status)}">${esc(STATUS_LABEL[an.status] || an.status)}</span>
        <span class="sem-analyze-hist-td sem-analyze-hist-prompt" title="${esc(an.prompt)}">${esc(an.prompt)}</span>
        <span class="sem-analyze-hist-td">Agente Karen</span>
        <span class="sem-analyze-hist-td">${an.tokens_input ?? "—"} / ${an.tokens_output ?? "—"}</span>
        <span class="sem-analyze-hist-td">${fmtDop(an.cost_usd)}</span>
      </div>
    `).join("");

    return `
      <div class="sem-analyze-block">
        <div class="sem-analyze-block-title">Consultas anteriores (${this._analyzeHistory.length})</div>
        <div class="sem-analyze-hist-table">
          <div class="sem-analyze-hist-row sem-analyze-hist-header">
            <span class="sem-analyze-hist-td">Estado</span>
            <span class="sem-analyze-hist-td">Prompt</span>
            <span class="sem-analyze-hist-td">Modelo</span>
            <span class="sem-analyze-hist-td">Tokens (in/out)</span>
            <span class="sem-analyze-hist-td">Costo</span>
          </div>
          ${rows}
        </div>
      </div>
    `;
  }
}
