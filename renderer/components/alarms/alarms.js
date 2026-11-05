const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SEVERITY_LABEL = { error: "Error", warning: "Advertencia", info: "Info" };
const SEVERITY_COLOR = { error: "#ef4444", warning: "#f59e0b", info: "#3b82f6" };

export class AlarmsPanel {
  constructor(mountEl, api) {
    this._el = mountEl;
    this._api = api;
    this._root = null;
    this._interval = null;
  }

  mount() {
    this._root = document.createElement("div");
    this._root.className = "alm-root";
    this._root.innerHTML = `
      <div class="alm-topbar">
        <div class="alm-title">Estado del sistema</div>
        <button class="alm-refresh-btn" title="Actualizar">↺</button>
      </div>
      <div class="alm-body">
        <div class="alm-loading">Verificando sistema…</div>
      </div>
    `;
    this._el.appendChild(this._root);
    this._root.querySelector(".alm-refresh-btn").addEventListener("click", () => this._load());
    this._load();
    this._interval = setInterval(() => this._load(), 30000);
  }

  destroy() {
    clearInterval(this._interval);
    this._root?.remove();
    this._root = null;
  }

  async _load() {
    const body = this._root?.querySelector(".alm-body");
    if (!body) return;

    // Fetch alarms + service status + channel status in parallel
    const [alarmResp, svcResp, chResp] = await Promise.allSettled([
      this._api({ method: "GET", path: "/service/alarms" }),
      this._api({ method: "GET", path: "/service/status", query: { all: true } }),
      this._api({ method: "GET", path: "/channel/status" }),
    ]);

    const alarms   = alarmResp.status === "fulfilled" && alarmResp.value?.ok ? alarmResp.value.data?.alarms || [] : [];
    const services = svcResp.status  === "fulfilled" && svcResp.value?.ok  ? svcResp.value.data?.services  || [] : [];
    const channels = chResp.status   === "fulfilled" && chResp.value?.ok   ? (Array.isArray(chResp.value.data) ? chResp.value.data : []) : [];

    body.innerHTML = "";

    // ── Summary pills ──────────────────────────────────────────────
    const errors   = alarms.filter(a => a.severity === "error").length;
    const warnings = alarms.filter(a => a.severity === "warning").length;
    const svcOk    = services.filter(s => s.state === "ACTIVE" && (s.status === "RUNNING" || s.status === "ACTIVE")).length;
    const svcFail  = services.length - svcOk;
    const chOk     = channels.filter(c => String(c.state || c.status || "").toUpperCase().includes("ACTIVE") || String(c.state || "").toUpperCase() === "OK").length;

    const summary = document.createElement("div");
    summary.className = "alm-summary";
    summary.innerHTML = `
      <div class="alm-pill ${errors > 0 ? "alm-pill-err" : "alm-pill-ok"}">
        <span class="alm-pill-icon">${errors > 0 ? "⚠" : "✓"}</span>
        <span>${errors > 0 ? `${errors} error${errors > 1 ? "es" : ""}` : "Sin errores"}</span>
      </div>
      <div class="alm-pill ${warnings > 0 ? "alm-pill-warn" : "alm-pill-ok"}">
        <span class="alm-pill-icon">◆</span>
        <span>${warnings > 0 ? `${warnings} advertencia${warnings > 1 ? "s" : ""}` : "Sin advertencias"}</span>
      </div>
      <div class="alm-pill ${svcFail > 0 ? "alm-pill-warn" : "alm-pill-ok"}">
        <span class="alm-pill-icon">⬡</span>
        <span>${svcOk}/${services.length} servicios activos</span>
      </div>
      ${channels.length ? `
      <div class="alm-pill ${chOk < channels.length ? "alm-pill-warn" : "alm-pill-ok"}">
        <span class="alm-pill-icon">◉</span>
        <span>${chOk}/${channels.length} cámaras en línea</span>
      </div>` : ""}
    `;
    body.appendChild(summary);

    // ── Active alarms ──────────────────────────────────────────────
    if (alarms.length > 0) {
      const section = document.createElement("div");
      section.className = "alm-section";
      section.innerHTML = `<div class="alm-section-title">Alarmas activas</div>`;

      alarms.forEach(alarm => {
        const card = document.createElement("div");
        card.className = `alm-card alm-card-${alarm.severity || "warning"}`;

        const color = SEVERITY_COLOR[alarm.severity] || SEVERITY_COLOR.warning;
        const label = SEVERITY_LABEL[alarm.severity] || "Aviso";

        let detail = "";
        if (alarm.type === "service") {
          detail = `
            <div class="alm-card-meta">
              <span class="alm-meta-chip">Canal ${_esc(alarm.channel)}</span>
              <span class="alm-meta-chip">${_esc(alarm.service)}</span>
              ${alarm.nrestarts > 0 ? `<span class="alm-meta-chip alm-chip-warn">↺ ${Number(alarm.nrestarts).toLocaleString()} reinicios</span>` : ""}
            </div>
            ${alarm.last_error ? `<div class="alm-card-log">${_esc(alarm.last_error)}</div>` : ""}
          `;
        }

        card.innerHTML = `
          <div class="alm-card-header">
            <span class="alm-card-dot" style="background:${color}"></span>
            <div class="alm-card-info">
              <div class="alm-card-title">${_esc(alarm.state || "")} — ${_esc(alarm.status || "")}</div>
              <div class="alm-card-ts">${_esc(alarm.ts || "")}</div>
            </div>
            <span class="alm-badge-sev" style="background:${color}22;color:${color}">${label}</span>
          </div>
          ${detail}
        `;

        // Click to expand logs
        if (alarm.type === "service" && alarm.channel) {
          card.style.cursor = "pointer";
          let expanded = false;
          let logBox = null;
          card.addEventListener("click", async () => {
            if (!expanded) {
              expanded = true;
              logBox = document.createElement("div");
              logBox.className = "alm-log-box";
              logBox.textContent = "Cargando registros…";
              card.appendChild(logBox);
              try {
                const r = await this._api({ method: "GET", path: "/service/logs", query: { channel: alarm.channel, lines: 20 } });
                const lines = (r?.data?.lines || []).join("\n") || "(sin registros)";
                logBox.innerHTML = "";
                const copyBtn = document.createElement("button");
                copyBtn.className = "alm-copy-btn";
                copyBtn.textContent = "Copiar";
                copyBtn.addEventListener("click", (e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(lines).then(() => {
                    copyBtn.textContent = "✓ Copiado";
                    setTimeout(() => { copyBtn.textContent = "Copiar"; }, 2000);
                  });
                });
                const pre = document.createElement("pre");
                pre.className = "alm-log-pre";
                pre.textContent = lines;
                logBox.appendChild(copyBtn);
                logBox.appendChild(pre);
              } catch (_) { logBox.textContent = "(error al cargar)"; }
            } else {
              expanded = false;
              logBox?.remove();
              logBox = null;
            }
          });
        }

        section.appendChild(card);
      });
      body.appendChild(section);
    }

    // ── Services overview ──────────────────────────────────────────
    if (services.length > 0) {
      const section = document.createElement("div");
      section.className = "alm-section";
      section.innerHTML = `<div class="alm-section-title">Servicios de grabación</div>`;

      const grid = document.createElement("div");
      grid.className = "alm-svc-grid";
      services.forEach(svc => {
        const ok   = svc.state === "ACTIVE" && (svc.status === "RUNNING" || svc.status === "ACTIVE");
        const warn = !ok;
        const dot  = ok ? "alm-dot-ok" : warn ? "alm-dot-warn" : "alm-dot-err";
        const item = document.createElement("div");
        item.className = "alm-svc-item";
        item.innerHTML = `
          <div class="alm-svc-header">
            <span class="alm-svc-dot ${dot}"></span>
            <span class="alm-svc-ch">Canal ${_esc(svc.channel)}</span>
            <span class="alm-svc-state">${_esc(svc.state)} · ${_esc(svc.status)}</span>
          </div>
          ${svc.nrestarts > 0 ? `<div class="alm-svc-restarts">↺ ${Number(svc.nrestarts).toLocaleString()} reinicios</div>` : ""}
        `;
        grid.appendChild(item);
      });
      section.appendChild(grid);
      body.appendChild(section);
    }

    // ── All clear ──────────────────────────────────────────────────
    if (alarms.length === 0 && services.length > 0 && svcFail === 0) {
      const clear = document.createElement("div");
      clear.className = "alm-all-clear";
      clear.innerHTML = `<div class="alm-clear-icon">✓</div><div>Sistema operando con normalidad</div>`;
      body.appendChild(clear);
    }

    if (services.length === 0 && alarms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "alm-empty";
      empty.textContent = "No hay servicios registrados";
      body.appendChild(empty);
    }
  }
}
