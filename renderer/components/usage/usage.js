// Uso y presupuesto de Gemini — GET /semantic/usage / POST /semantic/budget
// ([[073]], [[074]]) ya existen y funcionan del lado del backend. UI
// bespoke (no el motor de formularios genérico de Comandos) porque tiene
// estado propio (barra de progreso, refresco manual) — mismo criterio que
// CalcPanel ([[066]]).

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

// El backend calcula todo en USD (gemini_config.py, [[058]]) — esto es
// solo para MOSTRÁRSELO al usuario en pesos dominicanos, mismo criterio y
// misma tasa de referencia aproximada que semantic.js ([[067]]).
const USD_TO_DOP_RATE = 60;

function fmtDop(usd) {
  if (typeof usd !== "number" || Number.isNaN(usd)) return "—";
  return `RD$${(usd * USD_TO_DOP_RATE).toFixed(2)}`;
}

function fmtCredits(value) {
  return (typeof value === "number" && !Number.isNaN(value)) ? value.toFixed(3) : "—";
}

function pctTier(pct) {
  if (pct >= 90) return "crit";
  if (pct >= 70) return "warn";
  return "ok";
}

export class UsagePanel {
  constructor(hostEl, api) {
    this._el = hostEl;
    this._api = api;
    this._root = null;
  }

  mount() {
    this._root = document.createElement("div");
    this._root.className = "usage-root";
    this._root.innerHTML = `
      <div class="usage-header">
        <div class="usage-header-left">
          <span class="usage-header-icon">📈</span>
          <div>
            <div class="usage-title">Uso</div>
            <div class="usage-badge">SEMANTIC.USAGE</div>
          </div>
        </div>
        <div class="usage-breadcrumb">Comandos / Uso</div>
      </div>
      <div class="usage-body" id="usage-body">
        <div class="usage-loading">Cargando…</div>
      </div>
    `;
    this._el.appendChild(this._root);
    void this._load();
  }

  destroy() {
    this._root?.remove();
    this._root = null;
  }

  async _load() {
    const body = this._root?.querySelector("#usage-body");
    if (!body) return;
    body.innerHTML = `<div class="usage-loading">Cargando…</div>`;

    let res;
    try {
      res = await this._api({ method: "GET", path: "/semantic/usage" });
    } catch (err) {
      if (!this._root) return;
      this._renderError(err?.message || String(err));
      return;
    }
    if (!this._root) return; // el panel se destruyó mientras cargaba

    if (!res?.ok) {
      this._renderError(res?.data?.message || res?.data?.detail || "No se pudo cargar el uso.");
      return;
    }
    this._render(res.data || {});
  }

  _renderError(message) {
    const body = this._root?.querySelector("#usage-body");
    if (!body) return;
    body.innerHTML = `
      <div class="usage-error">✗ ${esc(message)}</div>
      <div class="usage-actions">
        <button class="usage-btn-ghost" id="usage-refresh" type="button">↻ Reintentar</button>
      </div>
    `;
    body.querySelector("#usage-refresh")?.addEventListener("click", () => this._load());
  }

  _render(data) {
    const body = this._root?.querySelector("#usage-body");
    if (!body) return;

    const hasBudget = typeof data.budget_usd === "number";
    const pct = typeof data.pct_used === "number" ? Math.max(0, Math.min(999, Math.round(data.pct_used))) : 0;
    const tier = pctTier(pct);

    body.innerHTML = `
      ${hasBudget ? `
        <div class="usage-bar-wrap">
          <div class="usage-bar-track">
            <div class="usage-bar-fill usage-bar-${tier}" id="usage-bar-fill"></div>
          </div>
          <div class="usage-bar-label">${pct}% del presupuesto usado</div>
        </div>
      ` : `
        <div class="usage-note">
          <span class="usage-note-icon">ℹ</span>
          <p class="usage-note-text">
            Presupuesto no configurado todavía. Configuralo desde la
            terminal: <code>karenvision semantic budget set --usd N</code>
          </p>
        </div>
      `}

      <div class="usage-metrics">
        <div class="usage-metric">
          <div class="usage-metric-label">Gastado</div>
          <div class="usage-metric-value">${esc(fmtDop(data.spent_usd))}</div>
          <div class="usage-metric-sub">${esc(fmtCredits(data.spent_credits))} créditos</div>
        </div>
        <div class="usage-metric">
          <div class="usage-metric-label">Presupuesto</div>
          <div class="usage-metric-value">${hasBudget ? esc(fmtDop(data.budget_usd)) : "—"}</div>
          <div class="usage-metric-sub">${hasBudget ? `${esc(fmtCredits(data.budget_credits))} créditos` : ""}</div>
        </div>
        <div class="usage-metric">
          <div class="usage-metric-label">Restante</div>
          <div class="usage-metric-value ${hasBudget ? `usage-metric-${tier}` : ""}">${hasBudget ? esc(fmtDop(data.remaining_usd)) : "—"}</div>
          <div class="usage-metric-sub">${hasBudget ? `${esc(fmtCredits(data.remaining_credits))} créditos` : ""}</div>
        </div>
      </div>

      <div class="usage-actions">
        <button class="usage-btn-ghost" id="usage-refresh" type="button">↻ Actualizar</button>
      </div>
    `;

    // CSP de la app (index.html: style-src 'self', sin unsafe-inline)
    // bloquea silenciosamente los style="..." puestos en el HTML — el
    // ancho de la barra hay que asignarlo vía CSSOM (.style.width), mismo
    // patrón que ya usan commands-renderers.js/playback.js/storage.js.
    if (hasBudget) {
      const fill = body.querySelector("#usage-bar-fill");
      if (fill) fill.style.width = `${Math.min(100, pct)}%`;
    }

    body.querySelector("#usage-refresh")?.addEventListener("click", () => this._load());
  }
}
