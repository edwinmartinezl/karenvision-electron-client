// Audit Explorer — calendario + filtro por módulo + lista de eventos
// Reemplaza el flujo de formulario estándar para el módulo de auditoría.

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];
const MONTH_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DOW_LABELS = ["Lu","Ma","Mi","Ju","Vi","Sá","Do"];

const SDK_MODULES = [
  "camera","record","storage","group","timeline","channel",
  "quota","service","system","performance","play","audit","client"
];

function esc(v) {
  return String(v ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function pad2(n) { return String(n).padStart(2,"0"); }
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

export class AuditExplorer {
  constructor(mountEl, api) {
    this.mountEl = mountEl;
    this.api = api;
    this.rootEl = null;

    const now = new Date();
    this._viewYear  = now.getFullYear();
    this._viewMonth = now.getMonth();
    this._todayStr  = isoDate(now);
    this._selectedDate = null;
    this._activeModule = "all";
    this._loading = false;
    this._limit = 500;
  }

  mount() {
    const root = document.createElement("div");
    root.className = "audit-exp";

    // Module filter chips
    const chipsHtml = ["all", ...SDK_MODULES].map(m =>
      `<button class="audit-mod-chip${m === "all" ? " active" : ""}" data-mod="${m}">
        ${m === "all" ? "Todos" : m}
      </button>`
    ).join("");

    root.innerHTML = `
      <div class="audit-filters">${chipsHtml}</div>
      <div class="audit-main">
        <div class="audit-cal-panel">
          <div class="audit-cal-nav">
            <button class="audit-cal-arrow" id="ae-prev">‹</button>
            <span class="audit-cal-month" id="ae-month-label"></span>
            <button class="audit-cal-arrow" id="ae-next">›</button>
          </div>
          <div class="audit-cal-grid" id="ae-cal-grid"></div>
          <div class="audit-cal-foot" id="ae-cal-foot">Selecciona un día</div>
        </div>
        <div class="audit-events-panel">
          <div class="audit-events-hdr" id="ae-events-hdr">
            <div class="ae-hdr-info">
              <span class="audit-events-hdr-title">Eventos</span>
            </div>
            <button class="ae-refresh-btn" id="ae-refresh-btn" title="Actualizar">⟳ Actualizar</button>
          </div>
          <div class="audit-events-list" id="ae-events-list">
            <div class="audit-ev-empty">← Selecciona un día en el calendario</div>
          </div>
        </div>
      </div>
    `;

    this.mountEl.appendChild(root);
    this.rootEl = root;

    // Module chips
    root.querySelectorAll(".audit-mod-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        root.querySelectorAll(".audit-mod-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        this._activeModule = chip.dataset.mod;
        if (this._selectedDate) this._loadEvents();
      });
    });

    // Calendar nav
    root.querySelector("#ae-prev").addEventListener("click", () => {
      if (--this._viewMonth < 0) { this._viewMonth = 11; this._viewYear--; }
      this._renderCalendar();
    });
    root.querySelector("#ae-next").addEventListener("click", () => {
      if (++this._viewMonth > 11) { this._viewMonth = 0; this._viewYear++; }
      this._renderCalendar();
    });

    // Delegado en el header, no en el botón — _loadEvents() reemplaza
    // #ae-events-hdr.innerHTML en cada carga, así que un listener puesto
    // directo en el botón se perdería después de la primera recarga.
    root.querySelector("#ae-events-hdr").addEventListener("click", (e) => {
      if (e.target.closest("#ae-refresh-btn") && !this._loading) this._loadEvents();
    });

    this._renderCalendar();
    // Auto-select today
    this._selectDate(this._todayStr);
  }

  // ── Calendar ──────────────────────────────────────────────────────────────

  _renderCalendar() {
    const label = this.rootEl.querySelector("#ae-month-label");
    const grid  = this.rootEl.querySelector("#ae-cal-grid");

    label.textContent = `${MONTH_NAMES[this._viewMonth]} ${this._viewYear}`;

    const firstDay = new Date(this._viewYear, this._viewMonth, 1);
    const daysInMonth = new Date(this._viewYear, this._viewMonth + 1, 0).getDate();
    // Mon-based: Sunday=6, Mon=0
    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;

    let html = DOW_LABELS.map(d => `<div class="ae-dow">${d}</div>`).join("");
    for (let i = 0; i < startDow; i++) html += `<div class="ae-day empty"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${this._viewYear}-${pad2(this._viewMonth+1)}-${pad2(d)}`;
      const cls = [
        "ae-day",
        ds === this._todayStr    ? "today"    : "",
        ds === this._selectedDate ? "selected" : "",
      ].filter(Boolean).join(" ");
      html += `<div class="${cls}" data-date="${ds}">${d}</div>`;
    }

    grid.innerHTML = html;
    grid.querySelectorAll(".ae-day:not(.empty)").forEach(cell => {
      cell.addEventListener("click", () => this._selectDate(cell.dataset.date));
    });
  }

  _selectDate(dateStr) {
    this._selectedDate = dateStr;
    // Navigate calendar to correct month if needed
    const [y, m] = dateStr.split("-").map(Number);
    if (y !== this._viewYear || m - 1 !== this._viewMonth) {
      this._viewYear = y;
      this._viewMonth = m - 1;
      this._renderCalendar();
    } else {
      // Just update selection highlight
      this.rootEl?.querySelectorAll(".ae-day").forEach(c => {
        c.classList.toggle("selected", c.dataset.date === dateStr);
      });
    }
    this._loadEvents();
  }

  // ── Events ────────────────────────────────────────────────────────────────

  async _loadEvents() {
    if (!this._selectedDate || !this.api) return;
    this._loading = true;

    const list = this.rootEl.querySelector("#ae-events-list");
    const hdr  = this.rootEl.querySelector("#ae-events-hdr");
    list.innerHTML = '<div class="audit-ev-empty"><span class="cmd-spinning">⟳</span> Cargando…</div>';

    // Convierte el día local seleccionado a un rango UTC correcto — mandar
    // "YYYY-MM-DDT00:00:00" sin offset hace que el backend lo interprete
    // como UTC (_parse_user_ts en commands/audit/audit.py), no como
    // medianoche local. Con AST (UTC-4) eso recorta las últimas ~4h del
    // día y deja fuera eventos recientes de la tarde/noche.
    const [selY, selM, selD] = this._selectedDate.split("-").map(Number);
    const body = {
      from_ts: new Date(selY, selM - 1, selD,  0,  0,  0).toISOString(),
      to_ts:   new Date(selY, selM - 1, selD, 23, 59, 59).toISOString(),
      limit: this._limit,
    };
    if (this._activeModule !== "all") body.module = this._activeModule;

    let res;
    try {
      res = await this.api({ method: "POST", path: "/audit/event", body });
    } catch (err) {
      list.innerHTML = `<div class="audit-ev-empty">Error: ${esc(err.message)}</div>`;
      this._loading = false;
      return;
    }
    this._loading = false;

    if (!res.ok) {
      const detail = res.data?.detail || JSON.stringify(res.data);
      list.innerHTML = `<div class="audit-ev-empty">Error ${res.status}: ${esc(String(detail))}</div>`;
      console.error("[audit] error response:", res.status, res.data);
      return;
    }

    console.log("[audit] response ok, keys:", Object.keys(res.data || {}), "records:", (res.data?.records || []).length);
    const records = res.data?.records || [];
    const truncated = res.data?.truncated;

    // Update footer hint on calendar
    const foot = this.rootEl.querySelector("#ae-cal-foot");
    if (foot) foot.textContent = `${records.length} evento${records.length !== 1 ? "s" : ""}${truncated ? " (ver todos ↑)" : ""}`;

    // Header
    const [y, m, d] = this._selectedDate.split("-").map(Number);
    hdr.innerHTML = `
      <div class="ae-hdr-info">
        <span class="audit-events-hdr-title">${d} ${MONTH_SHORT[m-1]} ${y}</span>
        <span class="audit-events-hdr-count">${records.length} evento${records.length !== 1 ? "s" : ""}${truncated ? ` <span class="audit-trunc">truncado</span>` : ""}</span>
      </div>
      <button class="ae-refresh-btn" id="ae-refresh-btn" title="Actualizar">⟳ Actualizar</button>
    `;

    if (records.length === 0) {
      list.innerHTML = '<div class="audit-ev-empty">Sin eventos para este día</div>';
      return;
    }

    // Group by hour for visual separation
    list.innerHTML = "";
    let lastHour = null;

    records.forEach(rec => {
      const ts = rec.ts ? new Date(rec.ts) : null;
      const hour = ts ? ts.getHours() : null;
      const timeStr = ts
        ? `${pad2(ts.getHours())}:${pad2(ts.getMinutes())}:${pad2(ts.getSeconds())}`
        : "??:??:??";

      if (hour !== lastHour) {
        lastHour = hour;
        if (ts) {
          const sep = document.createElement("div");
          sep.className = "audit-hour-sep";
          sep.textContent = `${pad2(hour)}:00`;
          list.appendChild(sep);
        }
      }

      const row = document.createElement("div");
      row.className = "audit-event-row";

      const mod  = rec.module   || "";
      const name = rec.name     || rec.event || "event";
      const sev  = rec.severity || "info";
      const ch   = rec.channel != null ? `CH${rec.channel}` : "";
      const msg  = rec.message  || "";

      row.innerHTML = `
        <div class="ae-ev-time">${esc(timeStr)}</div>
        <div class="ae-ev-body">
          <div class="ae-ev-title">
            ${mod ? `<span class="ae-ev-mod">${esc(mod)}</span><span class="ae-ev-dot">·</span>` : ""}
            <span class="ae-ev-name">${esc(name)}</span>
            ${ch ? `<span class="ae-ev-ch">${esc(ch)}</span>` : ""}
          </div>
          ${msg ? `<div class="ae-ev-msg">${esc(msg)}</div>` : ""}
        </div>
        <span class="ae-ev-sev ${esc(sev)}">${esc(sev)}</span>
      `;

      row.addEventListener("click", () => this._toggleDetail(rec, row));
      list.appendChild(row);
    });
  }

  _toggleDetail(rec, rowEl) {
    const next = rowEl.nextElementSibling;
    if (next?.classList.contains("ae-ev-detail")) {
      next.remove();
      rowEl.classList.remove("expanded");
      return;
    }
    // Close others
    this.rootEl.querySelectorAll(".ae-ev-detail").forEach(el => el.remove());
    this.rootEl.querySelectorAll(".audit-event-row.expanded").forEach(el => el.classList.remove("expanded"));

    rowEl.classList.add("expanded");
    const detail = document.createElement("div");
    detail.className = "ae-ev-detail";

    const rows = Object.entries(rec)
      .filter(([k]) => k !== "_id")
      .map(([k, v]) => {
        const val = typeof v === "object" && v !== null ? JSON.stringify(v, null, 2) : String(v ?? "—");
        return `<tr><td class="ae-dt-key">${esc(k)}</td><td class="ae-dt-val"><pre>${esc(val)}</pre></td></tr>`;
      }).join("");

    detail.innerHTML = `<table class="ae-detail-table">${rows}</table>`;
    rowEl.insertAdjacentElement("afterend", detail);
    detail.scrollIntoView({ block: "nearest" });
  }

  destroy() {
    this.rootEl?.remove();
    this.rootEl = null;
  }
}
