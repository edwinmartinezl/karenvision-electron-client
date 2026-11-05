// Calculadora de disco — POST /calc/run (calc.time.size / calc.size.time)

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

const UNIT_LABEL = { d: { one: "día", many: "días" }, h: { one: "hora", many: "horas" } };

const OPS = {
  "time-size": {
    id: "calc.time.size",
    label: "Tiempo → espacio",
    sub: "GB necesarios para grabar",
    fieldLabel: "Período a grabar",
    fieldHelp: "Cuánto tiempo quieres que el canal grabe de forma continua.",
    defaultQty: 7,
    defaultUnit: "d",
    resultLabel: "Espacio requerido",
  },
  "size-time": {
    id: "calc.size.time",
    label: "Espacio → tiempo",
    sub: "Tiempo que caben en X GB",
    fieldLabel: "Espacio disponible (GB)",
    fieldHelp: "Tamaño de disco que quieres usar para grabar este canal.",
    defaultQty: 100,
    defaultUnit: "d",
    resultLabel: "Tiempo disponible",
  },
};

function pctClass(pct) {
  if (pct >= 90) return "calc-metric-crit";
  if (pct >= 70) return "calc-metric-warn";
  return "calc-metric-ok";
}

export class CalcPanel {
  constructor(hostEl, api) {
    this._el = hostEl;
    this._api = api;
    this._root = null;
    this._activeOp = "time-size";
    this._busy = false;
  }

  mount() {
    this._root = document.createElement("div");
    this._root.className = "calc-root";
    this._root.innerHTML = `
      <div class="calc-header">
        <div class="calc-header-left">
          <span class="calc-header-icon">🧮</span>
          <div>
            <div class="calc-title">Calculadora de disco</div>
            <div class="calc-badge" id="calc-badge">CALC.TIME.SIZE</div>
          </div>
        </div>
        <div class="calc-breadcrumb">Comandos / Calculadora</div>
      </div>

      <div class="calc-layout">
        <div class="calc-sidebar">
          <div class="calc-sidebar-title">Tipo de cálculo</div>
          <button class="calc-op-btn active" data-op="time-size" type="button">
            <span class="calc-op-label">${esc(OPS["time-size"].label)}</span>
            <span class="calc-op-sub">${esc(OPS["time-size"].sub)}</span>
          </button>
          <button class="calc-op-btn" data-op="size-time" type="button">
            <span class="calc-op-label">${esc(OPS["size-time"].label)}</span>
            <span class="calc-op-sub">${esc(OPS["size-time"].sub)}</span>
          </button>
        </div>

        <div class="calc-panel">
          <div class="calc-field">
            <label class="calc-label" for="calc-channel">Canal</label>
            <p class="calc-help">Cámara sobre la que se calcula el consumo real de bitrate.</p>
            <select class="calc-select" id="calc-channel">
              <option value="">Cargando cámaras…</option>
            </select>
          </div>

          <div class="calc-field">
            <label class="calc-label" id="calc-field-label" for="calc-qty">${esc(OPS["time-size"].fieldLabel)}</label>
            <p class="calc-help" id="calc-field-help">${esc(OPS["time-size"].fieldHelp)}</p>
            <div class="calc-row">
              <input type="number" class="calc-input" id="calc-qty" min="1" step="1" value="${OPS["time-size"].defaultQty}">
              <select class="calc-select calc-unit" id="calc-unit">
                <option value="d">días</option>
                <option value="h">horas</option>
              </select>
            </div>
          </div>

          <div class="calc-note">
            <span class="calc-note-icon">ℹ</span>
            <p class="calc-note-text">El cálculo usa el bitrate real reportado por el stream de la cámara seleccionada, no un promedio genérico. La primera vez que se calcula un canal se mide en vivo (unos segundos) y el resultado queda en caché.</p>
          </div>

          <div class="calc-feedback" id="calc-feedback"></div>

          <div class="calc-actions">
            <button class="calc-btn-ghost" id="calc-clear" type="button">Limpiar</button>
            <button class="calc-btn-primary" id="calc-run" type="button">▶ Ejecutar</button>
          </div>

          <div class="calc-result">
            <div class="calc-result-title">Resultado</div>
            <div class="calc-result-grid">
              <div class="calc-metric">
                <div class="calc-metric-label" id="calc-metric1-label">${esc(OPS["time-size"].resultLabel)}</div>
                <div class="calc-metric-value" id="calc-metric1-value">—</div>
              </div>
              <div class="calc-metric" id="calc-metric2">
                <div class="calc-metric-label">Contra cuota actual</div>
                <div class="calc-metric-value" id="calc-metric2-value">—</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    this._el.appendChild(this._root);

    this._root.querySelectorAll(".calc-op-btn").forEach(btn => {
      btn.addEventListener("click", () => this._selectOp(btn.dataset.op));
    });
    this._root.querySelector("#calc-run").addEventListener("click", () => this._run());
    this._root.querySelector("#calc-clear").addEventListener("click", () => this._resetForm());

    void this._populateChannels();
  }

  destroy() {
    this._root?.remove();
    this._root = null;
  }

  // ── Operación activa ─────────────────────────────────────────────────────

  _selectOp(opKey) {
    if (!OPS[opKey] || this._activeOp === opKey) return;
    this._activeOp = opKey;
    const op = OPS[opKey];

    this._root.querySelectorAll(".calc-op-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.op === opKey)
    );
    this._root.querySelector("#calc-badge").textContent = op.id.toUpperCase();
    this._root.querySelector("#calc-field-label").textContent = op.fieldLabel;
    this._root.querySelector("#calc-field-help").textContent = op.fieldHelp;
    this._root.querySelector("#calc-qty").value = op.defaultQty;
    this._root.querySelector("#calc-unit").value = op.defaultUnit;
    this._root.querySelector("#calc-metric1-label").textContent = op.resultLabel;
    this._clearResult();
    this._clearFeedback();
  }

  _resetForm() {
    const op = OPS[this._activeOp];
    this._root.querySelector("#calc-qty").value = op.defaultQty;
    this._root.querySelector("#calc-unit").value = op.defaultUnit;
    this._clearResult();
    this._clearFeedback();
  }

  _clearResult() {
    this._root.querySelector("#calc-metric1-value").textContent = "—";
    const m2 = this._root.querySelector("#calc-metric2-value");
    m2.textContent = "—";
    m2.classList.remove("calc-metric-ok", "calc-metric-warn", "calc-metric-crit", "calc-metric-muted");
  }

  // ── Canal ────────────────────────────────────────────────────────────────

  async _loadChannels() {
    try {
      const res = await this._api({ method: "GET", path: "/camera/list" });
      return (res?.ok && Array.isArray(res.data)) ? res.data : [];
    } catch (_) {
      return [];
    }
  }

  async _populateChannels() {
    const channels = await this._loadChannels();
    const sel = this._root?.querySelector("#calc-channel");
    if (!sel) return; // el panel se destruyó mientras cargaba
    sel.innerHTML = channels.length
      ? channels.map(ch =>
          `<option value="${esc(String(ch.channel))}">Canal ${esc(String(ch.channel))} — ${esc(ch.name || "Sin nombre")} (${esc(ch.brand || "—")})</option>`
        ).join("")
      : `<option value="">Sin cámaras registradas</option>`;
  }

  // ── Feedback ─────────────────────────────────────────────────────────────

  _showError(msg) {
    const fb = this._root.querySelector("#calc-feedback");
    fb.textContent = `✗ ${msg}`;
    fb.className = "calc-feedback err";
  }

  _clearFeedback() {
    const fb = this._root.querySelector("#calc-feedback");
    fb.textContent = "";
    fb.className = "calc-feedback";
  }

  // ── Ejecución ────────────────────────────────────────────────────────────

  _setBusy(v) {
    this._busy = v;
    const btn = this._root.querySelector("#calc-run");
    btn.disabled = v;
    btn.textContent = v ? "Calculando…" : "▶ Ejecutar";
  }

  async _run() {
    if (this._busy || !this._root) return;

    const channel = this._root.querySelector("#calc-channel").value;
    const qty = parseInt(this._root.querySelector("#calc-qty").value, 10);
    const unit = this._root.querySelector("#calc-unit").value;

    if (!channel) { this._showError("Selecciona un canal."); return; }
    if (!qty || qty <= 0) { this._showError("Ingresa un valor mayor a 0."); return; }

    this._clearFeedback();
    this._setBusy(true);

    const expr = this._activeOp === "time-size" ? `${qty}${unit}/gb` : `${qty}gb/${unit}`;

    try {
      const res = await this._api({ method: "POST", path: "/calc/run", body: { expr, channel: String(channel) } });
      if (!res?.ok) throw new Error(res?.data?.detail || "Error al calcular");

      const row = (res.data?.results || [])[0];
      if (!row || row.status !== "ok") throw new Error(row?.error || "No se pudo calcular para ese canal");

      this._renderResult(row.value, qty, unit);
    } catch (err) {
      this._clearResult();
      this._showError(err.message || String(err));
    } finally {
      this._setBusy(false);
    }
  }

  async _renderResult(value, qty, unit) {
    const isTimeToSize = this._activeOp === "time-size";
    const m1 = this._root.querySelector("#calc-metric1-value");
    m1.textContent = isTimeToSize
      ? `${value} GB`
      : `${value} ${value === 1 ? UNIT_LABEL[unit].one : UNIT_LABEL[unit].many}`;

    // "Contra cuota actual": el espacio (dado o calculado, en GB) contra la cuota asignada al canal.
    const spaceGb = isTimeToSize ? value : qty;
    const channel = this._root.querySelector("#calc-channel").value;
    const m2 = this._root.querySelector("#calc-metric2-value");
    m2.classList.remove("calc-metric-ok", "calc-metric-warn", "calc-metric-crit", "calc-metric-muted");

    try {
      const usageRes = await this._api({ method: "GET", path: "/storage/usage", query: { channel } });
      const chUsage = usageRes?.ok ? (usageRes.data?.channels || [])[0] : null;
      const assignedBytes = chUsage?.assigned_bytes;

      if (!this._root) return; // destruido durante la consulta

      if (typeof assignedBytes !== "number" || assignedBytes <= 0) {
        m2.textContent = "Sin cuota";
        m2.classList.add("calc-metric-muted");
        return;
      }

      const spaceBytes = spaceGb * 1024 * 1024 * 1024;
      const pct = Math.min(999, Math.round((spaceBytes / assignedBytes) * 100));
      m2.textContent = `${pct}%`;
      m2.classList.add(pctClass(pct));
    } catch (_) {
      if (!this._root) return;
      m2.textContent = "—";
      m2.classList.add("calc-metric-muted");
    }
  }
}
