// Calendario de grabaciones por canal — REC.SCHEDULE.CAL
// GET/POST /schedule/* (definición de bloques, fase 1) + /schedule/status (motor, fase 2)

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

const DAYS = [
  { code: "mon", label: "Lun" },
  { code: "tue", label: "Mar" },
  { code: "wed", label: "Mié" },
  { code: "thu", label: "Jue" },
  { code: "fri", label: "Vie" },
  { code: "sat", label: "Sáb" },
  { code: "sun", label: "Dom" },
];
const DAY_ORDER = DAYS.map(d => d.code);
const DAY_LABEL = Object.fromEntries(DAYS.map(d => [d.code, d.label]));

function daysLabel(csv) {
  return String(csv || "").split(",").filter(Boolean).map(d => DAY_LABEL[d] || d).join(", ");
}

function fmtEvaluatedAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

// El backend devuelve el error de solapamiento en inglés y en una sola
// línea plana ("schedule overlap on mon 09:00-12:00 with existing block
// #31 (11:00-13:00)") — se reconoce ese patrón puntual para mostrarlo
// legible en la alerta; cualquier otro mensaje se muestra tal cual viene.
const OVERLAP_ERROR_RE = /^schedule overlap on (\w+) [\d:]+-[\d:]+ with existing block #(\d+) \(([\d:]+-[\d:]+)\)$/;

function humanizeScheduleError(msg) {
  const text = String(msg || "").trim();
  const m = text.match(OVERLAP_ERROR_RE);
  if (m) {
    const dayLabel = DAY_LABEL[m[1]] || m[1];
    return `Ese horario se superpone con el bloque #${m[2]} (${dayLabel} ${m[3]}) que ya existe para este canal.`;
  }
  return text || "Ocurrió un error inesperado.";
}

export class RecordSchedulePanel {
  constructor(hostEl, api, onToast) {
    this._el = hostEl;
    this._api = api;
    this._onToast = typeof onToast === "function" ? onToast : null;
    this._root = null;
    this._busy = false;

    this._channels = [];
    this._scheduledSet = new Set();
    this._selectedChannel = null;
    this._blocks = [];
    this._status = null;
  }

  // Alerta flotante centrada — mismo mecanismo que usa el resto de la app
  // para avisos de sistema (ToastStack, montado por app-controller.js).
  _toast(msg, type = "error") {
    this._onToast?.(msg, { type });
  }

  mount() {
    this._root = document.createElement("div");
    this._root.className = "sched-root";
    this._root.innerHTML = `
      <div class="sched-header">
        <div class="sched-header-left">
          <span class="sched-header-icon">🗓️</span>
          <div>
            <div class="sched-title">Calendario de Grabaciones</div>
            <div class="sched-badge">REC.SCHEDULE.CAL</div>
          </div>
        </div>
      </div>

      <div class="sched-layout">
        <div class="sched-sidebar">
          <div class="sched-sidebar-title">Canal</div>
          <input type="text" class="sched-search" id="sched-search" placeholder="Buscar por número, nombre o IP…" autocomplete="off">
          <div class="sched-channel-list" id="sched-channel-list">
            <div class="sched-empty-hint">Cargando cámaras…</div>
          </div>
        </div>

        <div class="sched-panel" id="sched-panel">
          <div class="sched-empty-state">
            <div class="sched-empty-icon">🗓️</div>
            <div class="sched-empty-text">Selecciona un canal para ver su calendario de grabación.</div>
          </div>
        </div>
      </div>

      <div class="sched-overlay sched-hidden" id="sched-overlay">
        <div class="sched-modal" id="sched-modal"></div>
      </div>
    `;
    this._el.appendChild(this._root);

    this._root.querySelector("#sched-search").addEventListener("input", () => this._renderChannelList());
    this._root.querySelector("#sched-overlay").addEventListener("click", e => {
      if (e.target === this._root.querySelector("#sched-overlay")) this._closeModal();
    });

    void this._bootstrap();
  }

  destroy() {
    this._root?.remove();
    this._root = null;
  }

  // ── Carga inicial ───────────────────────────────────────────────────────

  async _bootstrap() {
    const [channels, allBlocks] = await Promise.all([
      this._loadChannels(),
      this._loadAllScheduledChannels(),
    ]);
    if (!this._root) return; // destruido durante la carga

    this._channels = channels;
    this._scheduledSet = new Set(allBlocks.map(b => Number(b.channel)));
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

  // Una sola llamada sin `channel` trae los bloques de TODOS los canales —
  // se usa solo para pintar el badge "Configurado" en el selector, no se
  // repite por cada tecla del buscador (ver _renderChannelList, que filtra
  // en memoria sobre this._channels/this._scheduledSet ya cacheados).
  async _loadAllScheduledChannels() {
    try {
      const res = await this._api({ method: "GET", path: "/schedule/list" });
      return (res?.ok && Array.isArray(res.data?.blocks)) ? res.data.blocks : [];
    } catch (_) {
      return [];
    }
  }

  // ── Selector de canal ────────────────────────────────────────────────────

  _renderChannelList() {
    const wrap = this._root?.querySelector("#sched-channel-list");
    if (!wrap) return;

    const q = (this._root.querySelector("#sched-search")?.value || "").trim().toLowerCase();
    const filtered = !q ? this._channels : this._channels.filter(ch => {
      const hay = `${ch.channel} ${ch.name || ""} ${ch.ip || ""}`.toLowerCase();
      return hay.includes(q);
    });

    if (!filtered.length) {
      wrap.innerHTML = `<div class="sched-empty-hint">${this._channels.length ? "Sin resultados" : "Sin cámaras registradas"}</div>`;
      return;
    }

    wrap.innerHTML = filtered.map(ch => {
      const channel = Number(ch.channel);
      const configured = this._scheduledSet.has(channel);
      const active = this._selectedChannel === channel;
      return `
        <div class="sched-ch-row${active ? " active" : ""}" data-channel="${esc(String(channel))}">
          <span class="sched-ch-badge">CH${esc(String(channel))}</span>
          <div class="sched-ch-main">
            <div class="sched-ch-name">${esc(ch.name || "Sin nombre")}</div>
            <div class="sched-ch-ip">${esc(ch.ip || "")}</div>
          </div>
          ${configured ? '<span class="sched-ch-configured">● Configurado</span>' : ""}
        </div>
      `;
    }).join("");

    wrap.querySelectorAll(".sched-ch-row").forEach(row => {
      row.addEventListener("click", () => this._selectChannel(Number(row.dataset.channel)));
    });
  }

  async _selectChannel(channel) {
    if (this._selectedChannel === channel) return;
    this._selectedChannel = channel;
    this._renderChannelList();
    await this._loadChannelSchedule();
  }

  async _loadChannelSchedule() {
    const panel = this._root?.querySelector("#sched-panel");
    if (!panel) return;
    panel.innerHTML = '<div class="sched-loading">Cargando calendario…</div>';

    const channel = this._selectedChannel;
    const [statusRes, listRes] = await Promise.all([
      this._api({ method: "GET", path: "/schedule/status", query: { channel } }),
      this._api({ method: "GET", path: "/schedule/list", query: { channel } }),
    ]);

    // El usuario pudo haber elegido otro canal mientras esto cargaba.
    if (!this._root || this._selectedChannel !== channel) return;

    this._status = statusRes?.ok ? statusRes.data : null;
    this._blocks = listRes?.ok ? (listRes.data?.blocks || []) : [];
    this._renderPanel();
  }

  // ── Panel de detalle ─────────────────────────────────────────────────────

  _renderPanel() {
    const panel = this._root?.querySelector("#sched-panel");
    if (!panel) return;

    const channel = this._selectedChannel;
    const hasBlocks = this._blocks.length > 0;

    panel.innerHTML = `
      <div class="sched-panel-header">
        <div class="sched-panel-title">Canal ${esc(String(channel))}</div>
        ${hasBlocks ? `<button class="sched-btn-danger" id="sched-clear-btn" type="button">Borrar todos los bloques del canal</button>` : ""}
      </div>

      ${hasBlocks ? this._statusCardHtml() : ""}
      ${hasBlocks ? `<div class="sched-week-wrap" id="sched-week"></div>` : ""}
      ${hasBlocks ? this._tableHtml() : `<div class="sched-empty-channel">Este canal no tiene calendario configurado.</div>`}

      <div class="sched-form-wrap">
        <div class="sched-form-title">Agregar bloque</div>
        <div class="sched-day-chips" id="sched-day-chips">
          ${DAYS.map(d => `<button type="button" class="sched-day-chip" data-day="${d.code}">${d.label}</button>`).join("")}
        </div>
        <div class="sched-form-row">
          <div class="sched-form-field">
            <label for="sched-start">Inicio</label>
            <input type="time" id="sched-start" value="08:00">
          </div>
          <div class="sched-form-field">
            <label for="sched-end">Fin</label>
            <input type="time" id="sched-end" value="18:00">
          </div>
          <button class="sched-btn-primary" id="sched-add-btn" type="button">+ Agregar</button>
        </div>
        <div class="sched-form-feedback" id="sched-form-feedback"></div>
      </div>
    `;

    if (hasBlocks) this._renderWeekGrid();

    panel.querySelectorAll(".sched-day-chip").forEach(chip => {
      chip.addEventListener("click", () => chip.classList.toggle("active"));
    });
    panel.querySelector("#sched-add-btn")?.addEventListener("click", () => this._addBlock());
    panel.querySelector("#sched-clear-btn")?.addEventListener("click", () => this._confirmClear());
    panel.querySelectorAll(".sched-td-remove").forEach(btn => {
      btn.addEventListener("click", () => this._removeBlock(Number(btn.dataset.id)));
    });
  }

  _statusCardHtml() {
    const s = this._status;
    if (!s) {
      return `<div class="sched-status-card"><div class="sched-status-err">No se pudo cargar el estado actual.</div></div>`;
    }
    const active = Boolean(s.should_be_recording);
    const block = s.active_block;
    return `
      <div class="sched-status-card">
        <div class="sched-status-title">Estado actual</div>
        <div class="sched-status-grid">
          <div class="sched-metric">
            <div class="sched-metric-label">¿Debería estar grabando?</div>
            <div class="sched-metric-value ${active ? "sched-metric-ok" : "sched-metric-muted"}">${active ? "Sí" : "No"}</div>
          </div>
          <div class="sched-metric">
            <div class="sched-metric-label">Bloque activo</div>
            <div class="sched-metric-value sched-metric-small">${block ? `${esc(daysLabel(block.days))} ${esc(block.start_time)}–${esc(block.end_time)}` : "—"}</div>
          </div>
          <div class="sched-metric">
            <div class="sched-metric-label">Evaluado</div>
            <div class="sched-metric-value sched-metric-small">${esc(fmtEvaluatedAt(s.evaluated_at))}</div>
          </div>
        </div>
      </div>
    `;
  }

  _tableHtml() {
    const rows = this._blocks.map(b => `
      <div class="sched-table-row">
        <span class="sched-td sched-td-id">#${esc(String(b.id))}</span>
        <span class="sched-td sched-td-days">${esc(daysLabel(b.days))}</span>
        <span class="sched-td sched-td-time">${esc(b.start_time)}–${esc(b.end_time)}</span>
        <span class="sched-td sched-td-enabled">${b.enabled ? "Sí" : "No"}</span>
        <button class="sched-td-remove" data-id="${esc(String(b.id))}" type="button" title="Eliminar bloque">✕</button>
      </div>
    `).join("");

    return `
      <div class="sched-table">
        <div class="sched-table-header">
          <span class="sched-td sched-td-id">ID</span>
          <span class="sched-td sched-td-days">Días</span>
          <span class="sched-td sched-td-time">Horario</span>
          <span class="sched-td sched-td-enabled">Habilitado</span>
          <span class="sched-td"></span>
        </div>
        ${rows}
      </div>
    `;
  }

  // ── Vista semanal ────────────────────────────────────────────────────────

  _renderWeekGrid() {
    const wrap = this._root?.querySelector("#sched-week");
    if (!wrap) return;

    // Expandir cada bloque en (día, minuto-desde, minuto-hasta). Un bloque
    // que cruza medianoche (end <= start) se parte en dos tramos — mismo
    // criterio que is_channel_scheduled_now en el backend (coredb.py).
    const segmentsByDay = {};
    DAY_ORDER.forEach(d => { segmentsByDay[d] = []; });

    this._blocks.forEach(b => {
      if (!b.enabled) return;
      const days = String(b.days || "").split(",").filter(Boolean);
      const [sh, sm] = String(b.start_time).split(":").map(Number);
      const [eh, em] = String(b.end_time).split(":").map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;

      days.forEach(day => {
        if (!segmentsByDay[day]) return;
        if (endMin <= startMin) {
          segmentsByDay[day].push({ from: startMin, to: 1440, id: b.id });
          const nextDay = DAY_ORDER[(DAY_ORDER.indexOf(day) + 1) % 7];
          segmentsByDay[nextDay]?.push({ from: 0, to: endMin, id: b.id });
        } else {
          segmentsByDay[day].push({ from: startMin, to: endMin, id: b.id });
        }
      });
    });

    wrap.innerHTML = `
      <div class="sched-week-title">Vista semanal</div>
      <div class="sched-week-grid">
        ${DAY_ORDER.map(d => `
          <div class="sched-week-row">
            <span class="sched-week-day">${DAY_LABEL[d]}</span>
            <div class="sched-week-track" data-day="${d}"></div>
          </div>
        `).join("")}
      </div>
      <div class="sched-week-hours">
        ${[0, 4, 8, 12, 16, 20, 24].map(h => `<span>${String(h).padStart(2, "0")}:00</span>`).join("")}
      </div>
    `;

    DAY_ORDER.forEach(d => {
      const track = wrap.querySelector(`.sched-week-track[data-day="${d}"]`);
      if (!track) return;
      segmentsByDay[d].forEach(seg => {
        const bar = document.createElement("div");
        bar.className = "sched-week-bar";
        bar.style.left = ((seg.from / 1440) * 100).toFixed(3) + "%";
        bar.style.width = Math.max(0.5, ((seg.to - seg.from) / 1440) * 100).toFixed(3) + "%";
        bar.title = `Bloque #${seg.id}`;
        track.appendChild(bar);
      });
    });
  }

  // ── Formulario: agregar bloque ───────────────────────────────────────────

  _setFormFeedback(msg, isErr) {
    const fb = this._root?.querySelector("#sched-form-feedback");
    if (!fb) return;
    fb.textContent = msg || "";
    fb.className = "sched-form-feedback" + (isErr ? " err" : "");
  }

  async _addBlock() {
    if (this._busy) return;
    const panel = this._root?.querySelector("#sched-panel");
    if (!panel) return;

    const days = Array.from(panel.querySelectorAll(".sched-day-chip.active")).map(c => c.dataset.day);
    const start = panel.querySelector("#sched-start")?.value;
    const end = panel.querySelector("#sched-end")?.value;

    if (!days.length) { this._setFormFeedback("Selecciona al menos un día.", true); return; }
    if (!start || !end) { this._setFormFeedback("Indica hora de inicio y fin.", true); return; }

    this._busy = true;
    const addBtn = panel.querySelector("#sched-add-btn");
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = "Agregando…"; }
    this._setFormFeedback("", false);

    const channel = this._selectedChannel;
    const res = await this._api({
      method: "POST",
      path: "/schedule/set",
      body: { channel, days, start_time: start, end_time: end },
    });

    this._busy = false;
    if (!this._root || this._selectedChannel !== channel) return;

    const addBtnAfter = this._root.querySelector("#sched-add-btn");
    if (addBtnAfter) { addBtnAfter.disabled = false; addBtnAfter.textContent = "+ Agregar"; }

    if (!res?.ok) {
      const message = humanizeScheduleError(res?.data?.message || res?.data?.detail || "No se pudo crear el bloque.");
      this._setFormFeedback(message, true);
      this._toast(message, "error");
      return;
    }

    this._scheduledSet.add(channel);
    await this._loadChannelSchedule();
    this._renderChannelList();
    this._setFormFeedback("Bloque creado.", false);
  }

  async _removeBlock(id) {
    if (this._busy) return;
    this._busy = true;
    const res = await this._api({ method: "POST", path: "/schedule/remove", body: { id } });
    this._busy = false;
    if (!this._root) return;

    if (!res?.ok) {
      const message = humanizeScheduleError(res?.data?.message || res?.data?.detail || "No se pudo eliminar el bloque.");
      this._setFormFeedback(message, true);
      this._toast(message, "error");
      return;
    }

    await this._loadChannelSchedule();
    if (!this._blocks.length) this._scheduledSet.delete(this._selectedChannel);
    this._renderChannelList();
  }

  // ── Borrar todos los bloques del canal (modal propio, sin confirm()) ────

  _showModal(html) {
    const modal = this._root.querySelector("#sched-modal");
    modal.innerHTML = html;
    this._root.querySelector("#sched-overlay").classList.remove("sched-hidden");
    return modal;
  }

  _closeModal() {
    this._root?.querySelector("#sched-overlay")?.classList.add("sched-hidden");
    const modal = this._root?.querySelector("#sched-modal");
    if (modal) modal.innerHTML = "";
  }

  _confirmClear() {
    const channel = this._selectedChannel;
    const count = this._blocks.length;
    const modal = this._showModal(`
      <div class="sched-modal-header">
        <span class="sched-modal-title">Borrar todos los bloques</span>
        <button class="sched-modal-close" id="sched-mc" type="button">✕</button>
      </div>
      <div class="sched-modal-body">
        <div class="sched-del-warn">
          Se eliminarán los ${esc(String(count))} bloque(s) de horario del canal ${esc(String(channel))}.
          Esta acción no se puede deshacer.
        </div>
        <div class="sched-modal-status" id="sched-modal-status"></div>
      </div>
      <div class="sched-modal-footer">
        <button class="sched-btn-ghost" id="sched-modal-cancel" type="button">Cancelar</button>
        <button class="sched-btn-danger" id="sched-modal-confirm" type="button">Borrar todos</button>
      </div>
    `);
    modal.querySelector("#sched-mc").addEventListener("click", () => this._closeModal());
    modal.querySelector("#sched-modal-cancel").addEventListener("click", () => this._closeModal());
    modal.querySelector("#sched-modal-confirm").addEventListener("click", () => this._doClear(modal, channel));
  }

  async _doClear(modal, channel) {
    const btn = modal.querySelector("#sched-modal-confirm");
    const status = modal.querySelector("#sched-modal-status");
    if (btn) { btn.disabled = true; btn.textContent = "Borrando…"; }

    const res = await this._api({ method: "POST", path: "/schedule/clear", body: { channel } });
    if (!this._root) return;

    if (!res?.ok) {
      const message = humanizeScheduleError(res?.data?.message || res?.data?.detail || "No se pudo borrar.");
      if (status) { status.textContent = message; status.className = "sched-modal-status err"; }
      if (btn) { btn.disabled = false; btn.textContent = "Borrar todos"; }
      this._toast(message, "error");
      return;
    }

    this._closeModal();
    this._scheduledSet.delete(channel);
    if (this._selectedChannel === channel) await this._loadChannelSchedule();
    this._renderChannelList();
  }
}
