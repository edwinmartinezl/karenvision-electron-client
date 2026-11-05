const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const MEDIUM_LABEL = { local: "Local", network: "Red", cloud: "Nube", unknown: "—" };
const MEDIUM_ICON  = { local: "🖥", network: "🌐", cloud: "☁", unknown: "?" };
const MEDIUM_CLASS = { local: "stor-med-local", network: "stor-med-network", cloud: "stor-med-cloud", unknown: "stor-med-unknown" };

function _fmt(bytes) {
  if (bytes == null) return "—";
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + " TB";
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(1)  + " GB";
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(0)  + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}

function _pct(used, total) {
  if (!total || total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function _barClass(pct) {
  if (pct >= 90) return "stor-bar-fill-crit";
  if (pct >= 70) return "stor-bar-fill-warn";
  return "stor-bar-fill-ok";
}

export class StoragePanel {
  constructor(mountEl, api) {
    this._el = mountEl;
    this._api = api;
    this._root = null;
    this._interval = null;
  }

  mount() {
    this._root = document.createElement("div");
    this._root.className = "stor-root";
    this._root.innerHTML = `
      <div class="stor-topbar">
        <div class="stor-title">Almacenamiento</div>
        <button class="stor-refresh-btn" title="Actualizar">↺</button>
      </div>
      <div class="stor-body">
        <div class="stor-loading">Cargando datos…</div>
      </div>
    `;
    this._el.appendChild(this._root);
    this._root.querySelector(".stor-refresh-btn").addEventListener("click", () => this._load());
    this._load();
    this._interval = setInterval(() => this._load(), 30000);
  }

  destroy() {
    clearInterval(this._interval);
    this._root?.remove();
    this._root = null;
  }

  async _load() {
    const body = this._root?.querySelector(".stor-body");
    if (!body) return;

    const [usageResp, cameraResp] = await Promise.allSettled([
      this._api({ method: "GET", path: "/storage/usage" }),
      this._api({ method: "GET", path: "/camera/list" }),
    ]);

    const channels = usageResp.status === "fulfilled" && usageResp.value?.ok
      ? (usageResp.value.data?.channels || []) : [];
    const nvr = usageResp.status === "fulfilled" && usageResp.value?.ok
      ? usageResp.value.data?.nvr : null;
    const cameras = cameraResp.status === "fulfilled" && cameraResp.value?.ok
      ? (cameraResp.value.data || []) : [];

    const cameraByChannel = {};
    cameras.forEach(c => { if (c.channel != null) cameraByChannel[c.channel] = c; });

    body.innerHTML = "";

    if (channels.length === 0) {
      body.innerHTML = `<div class="stor-empty">No hay almacenamiento configurado</div>`;
      return;
    }

    // ── NVR total bar ──────────────────────────────────────────────
    if (nvr) {
      const nvrPct = _pct(nvr.used_bytes, nvr.assigned_bytes);
      const nvrEl = document.createElement("div");
      nvrEl.className = "stor-nvr-card";
      nvrEl.innerHTML = `
        <div class="stor-nvr-header">
          <span class="stor-nvr-label">Total NVR</span>
          <span class="stor-nvr-nums">
            <span class="stor-used">${_fmt(nvr.used_bytes)}</span>
            <span class="stor-sep"> / </span>
            <span class="stor-total">${_fmt(nvr.assigned_bytes)}</span>
            <span class="stor-pct-badge ${nvrPct >= 90 ? "stor-pct-crit" : nvrPct >= 70 ? "stor-pct-warn" : "stor-pct-ok"}">${nvrPct}%</span>
          </span>
        </div>
        <div class="stor-bar-track">
          <div class="stor-bar-fill ${_barClass(nvrPct)}" data-width="${nvrPct}"></div>
        </div>
        <div class="stor-nvr-free">Libre: <strong>${_fmt(nvr.free_bytes)}</strong></div>
      `;
      body.appendChild(nvrEl);
      // animate bar
      requestAnimationFrame(() => {
        const fill = nvrEl.querySelector(".stor-bar-fill");
        if (fill) fill.style.width = fill.dataset.width + "%";
      });
    }

    // ── Per-channel cards ──────────────────────────────────────────
    const section = document.createElement("div");
    section.className = "stor-section";
    section.innerHTML = `<div class="stor-section-title">Por canal</div>`;

    const grid = document.createElement("div");
    grid.className = "stor-grid";

    channels.sort((a, b) => (a.channel ?? 0) - (b.channel ?? 0)).forEach(ch => {
      const cam      = cameraByChannel[ch.channel];
      const pct      = _pct(ch.used_bytes, ch.assigned_bytes);
      const hasQuota = ch.assigned_bytes != null;
      const path     = ch.active_path || "—";
      const med      = ch.medium || "unknown";
      const medLabel = MEDIUM_LABEL[med] ?? med;
      const medIcon  = MEDIUM_ICON[med]  ?? "?";
      const medCls   = MEDIUM_CLASS[med] ?? "stor-med-unknown";

      const card = document.createElement("div");
      card.className = "stor-ch-card";
      card.innerHTML = `
        <div class="stor-ch-header">
          <span class="stor-ch-num">Canal ${_esc(ch.channel)}</span>
          ${cam?.name ? `<span class="stor-ch-name">${_esc(cam.name)}</span>` : ""}
          <span class="stor-med-badge ${medCls}">${medIcon} ${medLabel}</span>
        </div>

        ${hasQuota ? `
          <div class="stor-bar-track stor-bar-sm">
            <div class="stor-bar-fill ${_barClass(pct)}" data-width="${pct}"></div>
          </div>
          <div class="stor-ch-nums">
            <span class="stor-ch-used">${_fmt(ch.used_bytes)}</span>
            <span class="stor-ch-sep"> de </span>
            <span class="stor-ch-total">${_fmt(ch.assigned_bytes)}</span>
            <span class="stor-pct-badge ${pct >= 90 ? "stor-pct-crit" : pct >= 70 ? "stor-pct-warn" : "stor-pct-ok"}">${pct}%</span>
          </div>
          <div class="stor-ch-free">Libre: ${_fmt(ch.free_bytes)}</div>
        ` : `
          <div class="stor-ch-nums">
            <span class="stor-ch-used">${_fmt(ch.used_bytes)}</span>
            <span class="stor-no-quota">Sin cuota asignada</span>
          </div>
        `}

        <div class="stor-ch-path" title="${_esc(path)}">${_esc(path)}</div>
      `;

      grid.appendChild(card);
      requestAnimationFrame(() => {
        const fill = card.querySelector(".stor-bar-fill");
        if (fill) fill.style.width = fill.dataset.width + "%";
      });
    });

    section.appendChild(grid);
    body.appendChild(section);
  }
}
