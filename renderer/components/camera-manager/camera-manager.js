// Camera Manager — gestión completa de cámaras (add / update / delete / scan)

const BRANDS = ["dahua", "hikvision"];

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function brandBadge(brand) {
  return `<span class="cm-badge cm-brand">${esc(String(brand || "—").toLowerCase())}</span>`;
}

export class CameraManager {
  constructor(mountEl, api) {
    this.mountEl = mountEl;
    this.api = api;
    this.rootEl = null;
    this._cameras = [];
    this._activeTab = "cameras";
    this._scanning = false;
    this._busy = false;
  }

  mount() {
    const root = document.createElement("div");
    root.className = "cm-root";
    root.innerHTML = `
      <div class="cm-topbar">
        <nav class="cm-tabs">
          <button class="cm-tab active" data-tab="cameras">Cámaras</button>
          <button class="cm-tab" data-tab="scan">Buscar en Red</button>
        </nav>
        <div class="cm-topbar-actions" id="cm-topbar-actions">
          <button class="cm-btn-primary" id="cm-btn-add-single">+ Agregar</button>
          <button class="cm-btn-secondary" id="cm-btn-add-bulk">Agregar en masa</button>
          <button class="cm-btn-ghost" id="cm-btn-refresh">↺</button>
        </div>
      </div>

      <div class="cm-body">
        <!-- Panel: lista de cámaras -->
        <div class="cm-panel" id="cm-panel-cameras">
          <div class="cm-table-wrap" id="cm-camera-table">
            <div class="cm-empty">Cargando…</div>
          </div>
        </div>

        <!-- Panel: escaneo de red -->
        <div class="cm-panel cm-hidden" id="cm-panel-scan">
          <div class="cm-scan-topbar">
            <button class="cm-btn-primary" id="cm-scan-btn">⌕ Escanear Red</button>
            <span class="cm-scan-hint">Detecta cámaras ONVIF activas en la red local</span>
          </div>
          <div class="cm-table-wrap" id="cm-scan-results">
            <div class="cm-empty">Presiona "Escanear Red" para buscar</div>
          </div>
        </div>
      </div>

      <!-- Modal overlay (add / edit / delete / bulk) -->
      <div class="cm-overlay cm-hidden" id="cm-overlay">
        <div class="cm-modal" id="cm-modal"></div>
      </div>
    `;

    this.mountEl.appendChild(root);
    this.rootEl = root;

    root.querySelectorAll(".cm-tab").forEach(t =>
      t.addEventListener("click", () => this._switchTab(t.dataset.tab))
    );
    root.querySelector("#cm-btn-add-single").addEventListener("click", () => this._openAddModal());
    root.querySelector("#cm-btn-add-bulk").addEventListener("click", () => this._openBulkModal());
    root.querySelector("#cm-btn-refresh").addEventListener("click", () => this._loadCameras());
    root.querySelector("#cm-scan-btn").addEventListener("click", () => this._startScan());
    root.querySelector("#cm-overlay").addEventListener("click", e => {
      if (e.target === root.querySelector("#cm-overlay")) this._closeModal();
    });

    this._loadCameras();
  }

  // ─── Tabs ──────────────────────────────────────────────────────────────────

  _switchTab(tab) {
    this._activeTab = tab;
    this.rootEl.querySelectorAll(".cm-tab").forEach(el =>
      el.classList.toggle("active", el.dataset.tab === tab)
    );
    this.rootEl.querySelector("#cm-panel-cameras").classList.toggle("cm-hidden", tab !== "cameras");
    this.rootEl.querySelector("#cm-panel-scan").classList.toggle("cm-hidden", tab !== "scan");
    const acts = this.rootEl.querySelector("#cm-topbar-actions");
    acts.style.visibility = tab === "cameras" ? "visible" : "hidden";
  }

  // ─── Load cameras ──────────────────────────────────────────────────────────

  async _loadCameras() {
    const wrap = this.rootEl.querySelector("#cm-camera-table");
    wrap.innerHTML = '<div class="cm-empty"><span class="cm-spin">⟳</span> Cargando…</div>';
    let res;
    try {
      res = await this.api({ method: "GET", path: "/camera/list" });
    } catch (err) {
      wrap.innerHTML = `<div class="cm-empty cm-err">Error: ${esc(err.message)}</div>`;
      return;
    }
    if (!res.ok) {
      wrap.innerHTML = `<div class="cm-empty cm-err">Error ${res.status}: ${esc(String(res.data?.detail || res.data?.error || ""))}</div>`;
      return;
    }
    this._cameras = Array.isArray(res.data) ? res.data : [];
    this._renderCameraTable();
  }

  _renderCameraTable() {
    const wrap = this.rootEl.querySelector("#cm-camera-table");
    if (this._cameras.length === 0) {
      wrap.innerHTML = `
        <div class="cm-empty-state">
          <div class="cm-empty-icon">⬜</div>
          <div class="cm-empty-msg">No hay cámaras configuradas</div>
          <button class="cm-btn-primary" id="cm-empty-add">+ Agregar primera cámara</button>
        </div>`;
      wrap.querySelector("#cm-empty-add").addEventListener("click", () => this._openAddModal());
      return;
    }

    const rows = this._cameras.map(cam => {
      const online = cam.enabled !== false;
      const name = cam.name || "";
      const ch = cam.channel ?? "—";
      const brand = String(cam.brand || "").toLowerCase();
      const ip = cam.ip || "—";
      const port = cam.rtsp_port || 554;
      return `
        <div class="cm-row" data-ch="${ch}">
          <div class="cm-row-dot ${online ? "on" : "off"}"></div>
          <div class="cm-row-ch">CH ${esc(String(ch))}</div>
          <div class="cm-row-name">${name ? esc(name) : `<span class="cm-muted">Sin nombre</span>`}</div>
          <div class="cm-row-brand">${brandBadge(brand)}</div>
          <div class="cm-row-ip cm-mono">${esc(ip)}</div>
          <div class="cm-row-port cm-mono">:${esc(String(port))}</div>
          <div class="cm-row-status">
            ${online ? '<span class="cm-pill ok">activa</span>' : '<span class="cm-pill off">sin acceso</span>'}
          </div>
          <div class="cm-row-actions">
            <button class="cm-row-btn edit" data-action="edit" data-ch="${ch}" title="Editar">✎ Editar</button>
            <button class="cm-row-btn del" data-action="del" data-ch="${ch}" title="Eliminar">✕</button>
          </div>
        </div>`;
    }).join("");

    wrap.innerHTML = `
      <div class="cm-table-head">
        <div></div>
        <div>Canal</div>
        <div>Nombre</div>
        <div>Marca</div>
        <div>IP</div>
        <div>Puerto</div>
        <div>Estado</div>
        <div></div>
      </div>
      <div class="cm-table-rows">${rows}</div>`;

    wrap.querySelectorAll("[data-action='edit']").forEach(btn =>
      btn.addEventListener("click", () => {
        const cam = this._cameras.find(c => c.channel === Number(btn.dataset.ch));
        if (cam) this._openEditModal(cam);
      })
    );
    wrap.querySelectorAll("[data-action='del']").forEach(btn =>
      btn.addEventListener("click", () => {
        const cam = this._cameras.find(c => c.channel === Number(btn.dataset.ch));
        if (cam) this._openDeleteModal(cam);
      })
    );
  }

  // ─── Modal helpers ─────────────────────────────────────────────────────────

  _showModal(html) {
    const modal = this.rootEl.querySelector("#cm-modal");
    modal.innerHTML = html;
    this.rootEl.querySelector("#cm-overlay").classList.remove("cm-hidden");
    return modal;
  }

  _closeModal() {
    this.rootEl.querySelector("#cm-overlay").classList.add("cm-hidden");
    this.rootEl.querySelector("#cm-modal").innerHTML = "";
  }

  _modalStatus(modal, msg, type = "") {
    const el = modal.querySelector(".cm-modal-status");
    if (!el) return;
    el.className = `cm-modal-status ${type}`;
    el.textContent = msg;
  }

  _setBusy(modal, busy, btnId, label, loadingLabel = "Guardando…") {
    this._busy = busy;
    const btn = modal.querySelector(btnId);
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? loadingLabel : label;
  }

  // ─── Add single camera ─────────────────────────────────────────────────────

  _nextChannel() {
    if (!this._cameras.length) return 1;
    return Math.max(...this._cameras.map(c => Number(c.channel) || 0)) + 1;
  }

  _openAddModal(prefill = {}) {
    const brandOpts = BRANDS.map(b =>
      `<option value="${b}" ${b === (prefill.brand || "dahua") ? "selected" : ""}>${b}</option>`
    ).join("");

    const nextCh = prefill.channel || this._nextChannel();

    const modal = this._showModal(`
      <div class="cm-modal-header">
        <span class="cm-modal-title">Agregar cámara</span>
        <button class="cm-modal-close" id="cm-mc">✕</button>
      </div>
      <div class="cm-modal-body">
        <div class="cm-form-grid">
          <div class="cm-field">
            <label>Marca</label>
            <select id="f-brand">${brandOpts}</select>
          </div>
          <div class="cm-field">
            <label>Canal</label>
            <input id="f-channel" type="number" min="1" value="${esc(String(nextCh))}">
          </div>
          <div class="cm-field cm-field-wide">
            <label>IP</label>
            <input id="f-ip" type="text" placeholder="192.168.1.100" value="${esc(prefill.ip || "")}">
          </div>
          <div class="cm-field">
            <label>Usuario</label>
            <input id="f-user" type="text" value="${esc(prefill.user || "admin")}">
          </div>
          <div class="cm-field">
            <label>Contraseña</label>
            <input id="f-password" type="password" placeholder="••••••">
          </div>
          <div class="cm-field">
            <label>Puerto RTSP</label>
            <input id="f-rtsp" type="number" value="554">
          </div>
          <div class="cm-field cm-field-wide">
            <label>Nombre <span class="cm-muted">(opcional)</span></label>
            <input id="f-name" type="text" placeholder="Ej: Entrada principal" maxlength="80">
          </div>
        </div>
        <div class="cm-modal-status"></div>
        <div class="cm-modal-hint">Se realizará una prueba de conexión RTSP antes de guardar.</div>
      </div>
      <div class="cm-modal-footer">
        <button class="cm-btn-ghost" id="cm-cancel">Cancelar</button>
        <button class="cm-btn-primary" id="cm-save">Agregar cámara</button>
      </div>
    `);

    modal.querySelector("#cm-mc").addEventListener("click", () => this._closeModal());
    modal.querySelector("#cm-cancel").addEventListener("click", () => this._closeModal());
    modal.querySelector("#cm-save").addEventListener("click", () => this._doAdd(modal));
    setTimeout(() => modal.querySelector("#f-ip")?.focus(), 60);
  }

  async _doAdd(modal) {
    if (this._busy) return;
    const brand    = modal.querySelector("#f-brand")?.value?.trim();
    const ip       = modal.querySelector("#f-ip")?.value?.trim();
    const user     = modal.querySelector("#f-user")?.value?.trim() || "admin";
    const password = modal.querySelector("#f-password")?.value;
    const rtsp     = parseInt(modal.querySelector("#f-rtsp")?.value) || 554;
    const chRaw    = modal.querySelector("#f-channel")?.value?.trim();
    const channel  = chRaw ? parseInt(chRaw) : undefined;
    const name     = modal.querySelector("#f-name")?.value?.trim() || undefined;

    if (!ip) { this._modalStatus(modal, "La IP es obligatoria.", "err"); return; }
    if (!password) { this._modalStatus(modal, "La contraseña es obligatoria.", "err"); return; }

    this._setBusy(modal, true, "#cm-save", "Agregar cámara", "Conectando…");
    this._modalStatus(modal, "Probando conexión RTSP…", "");

    const body = { brand, ip, user, password, rtsp_port: rtsp, probe_seconds: 3, probe_timeout: 12 };
    if (channel !== undefined) body.channel = channel;

    let res;
    try {
      res = await this.api({ method: "POST", path: "/camera/add", body });
    } catch (err) {
      this._setBusy(modal, false, "#cm-save", "Agregar cámara");
      this._modalStatus(modal, `Error: ${esc(err.message)}`, "err");
      return;
    }

    if (!res.ok) {
      this._setBusy(modal, false, "#cm-save", "Agregar cámara");
      const detail = res.data?.detail || res.data?.error || String(res.status);
      this._modalStatus(modal, `Error: ${esc(String(detail))}`, "err");
      return;
    }

    // If name was given, set it now
    const addedChannel = res.data?.channel;
    if (name && addedChannel !== undefined) {
      try { await this.api({ method: "POST", path: "/camera/name", body: { channel: addedChannel, name } }); }
      catch (_) {}
    }

    this._setBusy(modal, false, "#cm-save", "Agregar cámara");
    this._modalStatus(modal, `✓ Cámara agregada en canal ${addedChannel ?? "—"}`, "ok");
    setTimeout(() => { this._closeModal(); this._loadCameras(); }, 900);
  }

  // ─── Edit existing camera ──────────────────────────────────────────────────

  _openEditModal(cam) {
    const brandOpts = BRANDS.map(b =>
      `<option value="${b}" ${b === (cam.brand || "dahua") ? "selected" : ""}>${b}</option>`
    ).join("");

    const modal = this._showModal(`
      <div class="cm-modal-header">
        <span class="cm-modal-title">Editar cámara · Canal ${esc(String(cam.channel))}</span>
        <button class="cm-modal-close" id="cm-mc">✕</button>
      </div>
      <div class="cm-modal-body">
        <div class="cm-form-grid">
          <div class="cm-field cm-field-wide">
            <label>Nombre</label>
            <input id="f-name" type="text" placeholder="Ej: Entrada principal" maxlength="80"
              value="${esc(cam.name || "")}">
          </div>
          <div class="cm-field">
            <label>Marca</label>
            <select id="f-brand">${brandOpts}</select>
          </div>
          <div class="cm-field cm-field-wide">
            <label>IP</label>
            <input id="f-ip" type="text" value="${esc(cam.ip || "")}">
          </div>
          <div class="cm-field">
            <label>Usuario</label>
            <input id="f-user" type="text" value="${esc(cam.user || "admin")}">
          </div>
          <div class="cm-field">
            <label>Nueva contraseña <span class="cm-muted">(vacío = no cambiar)</span></label>
            <input id="f-password" type="password" placeholder="••••••">
          </div>
          <div class="cm-field">
            <label>Puerto RTSP</label>
            <input id="f-rtsp" type="number" value="${esc(String(cam.rtsp_port || 554))}">
          </div>
        </div>
        <div class="cm-modal-status"></div>
        <div class="cm-modal-hint">Los campos vacíos no se modificarán. El cambio de IP/credenciales re-prueba la conexión.</div>
      </div>
      <div class="cm-modal-footer">
        <button class="cm-btn-ghost" id="cm-cancel">Cancelar</button>
        <button class="cm-btn-primary" id="cm-save">Guardar cambios</button>
      </div>
    `);

    modal.querySelector("#cm-mc").addEventListener("click", () => this._closeModal());
    modal.querySelector("#cm-cancel").addEventListener("click", () => this._closeModal());
    modal.querySelector("#cm-save").addEventListener("click", () => this._doEdit(modal, cam));
    setTimeout(() => modal.querySelector("#f-name")?.focus(), 60);
  }

  async _doEdit(modal, cam) {
    if (this._busy) return;

    const name     = modal.querySelector("#f-name")?.value?.trim();
    const brand    = modal.querySelector("#f-brand")?.value?.trim();
    const ip       = modal.querySelector("#f-ip")?.value?.trim();
    const user     = modal.querySelector("#f-user")?.value?.trim();
    const password = modal.querySelector("#f-password")?.value;
    const rtsp     = parseInt(modal.querySelector("#f-rtsp")?.value) || 554;

    // Detect what actually changed
    const nameChanged = name !== undefined && name !== (cam.name || "");
    const updateBody = { channel: cam.channel };
    if (brand && brand !== cam.brand) updateBody.brand = brand;
    if (ip && ip !== cam.ip) updateBody.ip = ip;
    if (user && user !== (cam.user || "admin")) updateBody.user = user;
    if (password) updateBody.password = password;
    if (rtsp !== (cam.rtsp_port || 554)) updateBody.rtsp_port = rtsp;

    const hasConnUpdate = updateBody.brand || updateBody.ip || updateBody.user || updateBody.password || updateBody.rtsp_port;
    const hasAnyUpdate = hasConnUpdate || nameChanged;
    if (!hasAnyUpdate) { this._modalStatus(modal, "Sin cambios.", ""); return; }

    this._setBusy(modal, true, "#cm-save", "Guardar cambios", hasConnUpdate ? "Verificando…" : "Guardando…");
    this._modalStatus(modal, "", "");

    // Update connection fields (requires RTSP probe)
    if (hasConnUpdate) {
      const body = { channel: cam.channel, probe_seconds: 3, probe_timeout: 12 };
      if (updateBody.brand) body.brand = updateBody.brand;
      if (updateBody.ip) body.ip = updateBody.ip;
      if (updateBody.user) body.user = updateBody.user;
      if (updateBody.password) body.password = updateBody.password;
      if (updateBody.rtsp_port) body.rtsp_port = updateBody.rtsp_port;

      let res;
      try {
        res = await this.api({ method: "POST", path: "/camera/update", body });
      } catch (err) {
        this._setBusy(modal, false, "#cm-save", "Guardar cambios");
        this._modalStatus(modal, `Error: ${esc(err.message)}`, "err");
        return;
      }
      if (!res.ok) {
        this._setBusy(modal, false, "#cm-save", "Guardar cambios");
        const detail = res.data?.detail || res.data?.error || String(res.status);
        this._modalStatus(modal, `Error: ${esc(String(detail))}`, "err");
        return;
      }
    }

    // Update name separately (no probe needed)
    if (nameChanged) {
      try {
        await this.api({ method: "POST", path: "/camera/name", body: { channel: cam.channel, name } });
      } catch (_) {}
    }

    this._setBusy(modal, false, "#cm-save", "Guardar cambios");
    this._modalStatus(modal, "✓ Cambios guardados", "ok");
    setTimeout(() => { this._closeModal(); this._loadCameras(); }, 800);
  }

  // ─── Delete camera ─────────────────────────────────────────────────────────

  _openDeleteModal(cam) {
    const name = cam.name || `Canal ${cam.channel}`;
    const modal = this._showModal(`
      <div class="cm-modal-header">
        <span class="cm-modal-title">Eliminar cámara</span>
        <button class="cm-modal-close" id="cm-mc">✕</button>
      </div>
      <div class="cm-modal-body">
        <div class="cm-del-info">
          <div class="cm-del-icon">⚠</div>
          <div>
            <div class="cm-del-name">${esc(name)}</div>
            <div class="cm-del-meta">${brandBadge(cam.brand)} Canal ${esc(String(cam.channel))} · ${esc(cam.ip || "")}</div>
          </div>
        </div>
        <div class="cm-del-warn">Se detendrá la grabación y se eliminará la configuración de esta cámara. Esta acción no se puede deshacer.</div>
        <div class="cm-modal-status"></div>
      </div>
      <div class="cm-modal-footer">
        <button class="cm-btn-ghost" id="cm-cancel">Cancelar</button>
        <button class="cm-btn-danger" id="cm-del-confirm">Eliminar cámara</button>
      </div>
    `);

    modal.querySelector("#cm-mc").addEventListener("click", () => this._closeModal());
    modal.querySelector("#cm-cancel").addEventListener("click", () => this._closeModal());
    modal.querySelector("#cm-del-confirm").addEventListener("click", () => this._doDelete(modal, cam));
  }

  async _doDelete(modal, cam) {
    if (this._busy) return;
    this._setBusy(modal, true, "#cm-del-confirm", "Eliminar cámara", "Eliminando…");
    let res;
    try {
      res = await this.api({ method: "POST", path: "/camera/remove", body: { channel: cam.channel } });
    } catch (err) {
      this._setBusy(modal, false, "#cm-del-confirm", "Eliminar cámara");
      this._modalStatus(modal, `Error: ${esc(err.message)}`, "err");
      return;
    }
    if (!res.ok) {
      this._setBusy(modal, false, "#cm-del-confirm", "Eliminar cámara");
      const detail = res.data?.detail || res.data?.error || String(res.status);
      this._modalStatus(modal, `Error: ${esc(String(detail))}`, "err");
      return;
    }
    this._modalStatus(modal, "✓ Cámara eliminada", "ok");
    setTimeout(() => { this._closeModal(); this._loadCameras(); }, 700);
  }

  // ─── Bulk add ──────────────────────────────────────────────────────────────

  _openBulkModal() {
    const brandOpts = BRANDS.map(b =>
      `<option value="${b}" ${b === "dahua" ? "selected" : ""}>${b}</option>`
    ).join("");

    const modal = this._showModal(`
      <div class="cm-modal-header">
        <span class="cm-modal-title">Agregar cámaras en masa</span>
        <button class="cm-modal-close" id="cm-mc">✕</button>
      </div>
      <div class="cm-modal-body cm-modal-body-scroll">
        <div class="cm-form-grid cm-form-grid-3">
          <div class="cm-field">
            <label>Marca</label>
            <select id="f-brand">${brandOpts}</select>
          </div>
          <div class="cm-field">
            <label>Usuario</label>
            <input id="f-user" type="text" value="admin">
          </div>
          <div class="cm-field">
            <label>Puerto RTSP</label>
            <input id="f-rtsp" type="number" value="554">
          </div>
          <div class="cm-field">
            <label>Canal inicial</label>
            <input id="f-start-ch" type="number" min="1" value="${this._nextChannel()}">
          </div>
          <div class="cm-field">
            <label>Contraseña</label>
            <input id="f-password" type="password" placeholder="••••••">
          </div>
          <div class="cm-field">
            <label>Cuota / canal</label>
            <input id="f-quota" type="text" placeholder="50GB">
          </div>
        </div>
        <div class="cm-field" style="margin-bottom:10px">
          <label>IPs <span class="cm-muted">(separadas por coma)</span></label>
          <textarea id="f-ips" rows="2" placeholder="192.168.1.100, 192.168.1.101, 192.168.1.102"></textarea>
        </div>
        <div class="cm-form-grid cm-form-grid-2h">
          <div class="cm-field">
            <label>Ruta de almacenamiento</label>
            <input id="f-storage" type="text" placeholder="/mnt/storage">
          </div>
          <div class="cm-field">
            <label>Segmento de grabación</label>
            <input id="f-segment" type="text" placeholder="60s">
          </div>
        </div>
        <div class="cm-modal-status"></div>
        <div class="cm-modal-hint">Cada IP se asigna al canal siguiente, en orden a partir del canal inicial.</div>
      </div>
      <div class="cm-modal-footer">
        <button class="cm-btn-ghost" id="cm-cancel">Cancelar</button>
        <button class="cm-btn-primary" id="cm-save">Agregar todas</button>
      </div>
    `);

    modal.querySelector("#cm-mc").addEventListener("click", () => this._closeModal());
    modal.querySelector("#cm-cancel").addEventListener("click", () => this._closeModal());
    modal.querySelector("#cm-save").addEventListener("click", () => this._doBulkAdd(modal));
    setTimeout(() => modal.querySelector("#f-ips")?.focus(), 60);
  }

  async _doBulkAdd(modal) {
    if (this._busy) return;
    const brand       = modal.querySelector("#f-brand")?.value?.trim();
    const startCh     = parseInt(modal.querySelector("#f-start-ch")?.value) || 1;
    const user        = modal.querySelector("#f-user")?.value?.trim() || "admin";
    const password    = modal.querySelector("#f-password")?.value;
    const rtsp        = parseInt(modal.querySelector("#f-rtsp")?.value) || 554;
    const ipsRaw      = modal.querySelector("#f-ips")?.value?.trim();
    const storagePath = modal.querySelector("#f-storage")?.value?.trim();
    const quota       = modal.querySelector("#f-quota")?.value?.trim();
    const segment     = modal.querySelector("#f-segment")?.value?.trim();

    if (!ipsRaw)       { this._modalStatus(modal, "Ingresa al menos una IP.", "err"); return; }
    if (!password)     { this._modalStatus(modal, "La contraseña es obligatoria.", "err"); return; }
    if (!storagePath)  { this._modalStatus(modal, "La ruta de almacenamiento es obligatoria.", "err"); return; }
    if (!quota)        { this._modalStatus(modal, "La cuota es obligatoria (ej: 50GB).", "err"); return; }
    if (!segment)      { this._modalStatus(modal, "El segmento es obligatorio (ej: 60s).", "err"); return; }

    this._setBusy(modal, true, "#cm-save", "Agregar todas", "Procesando…");
    this._modalStatus(modal, "Agregando cámaras, esto puede tomar un momento…", "");

    let res;
    try {
      res = await this.api({
        method: "POST", path: "/camera/bulk-add",
        body: { brand, user, password, rtsp_port: rtsp, ips: ipsRaw, start_channel: startCh,
                storage_path: storagePath, quota, segment }
      });
    } catch (err) {
      this._setBusy(modal, false, "#cm-save", "Agregar todas");
      this._modalStatus(modal, `Error: ${esc(err.message)}`, "err");
      return;
    }

    this._setBusy(modal, false, "#cm-save", "Agregar todas");

    if (!res.ok) {
      const detail = res.data?.detail || res.data?.error || String(res.status);
      this._modalStatus(modal, `Error: ${esc(String(detail))}`, "err");
      return;
    }

    const { ok = 0, fail = 0, total = 0 } = res.data || {};
    const msg = `✓ ${ok} de ${total} cámaras agregadas${fail > 0 ? `, ${fail} con error` : ""}`;
    this._modalStatus(modal, msg, fail > 0 ? "" : "ok");
    setTimeout(() => { this._closeModal(); this._loadCameras(); }, 1200);
  }

  // ─── Network scan ──────────────────────────────────────────────────────────

  async _startScan() {
    if (this._scanning) return;
    this._scanning = true;
    const btn  = this.rootEl.querySelector("#cm-scan-btn");
    const wrap = this.rootEl.querySelector("#cm-scan-results");

    btn.disabled = true;
    btn.textContent = "⟳ Escaneando…";
    wrap.innerHTML = '<div class="cm-empty"><span class="cm-spin">⟳</span> Buscando cámaras en la red local…</div>';

    let res;
    try {
      res = await this.api({ method: "POST", path: "/camera/scan", body: { timeout: 6 } });
    } catch (err) {
      wrap.innerHTML = `<div class="cm-empty cm-err">Error: ${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = "⌕ Escanear Red"; this._scanning = false;
      return;
    }

    btn.disabled = false; btn.textContent = "⌕ Escanear Red"; this._scanning = false;

    if (!res.ok) {
      const detail = res.data?.detail || res.data?.error || String(res.status);
      wrap.innerHTML = `<div class="cm-empty cm-err">Error: ${esc(String(detail))}</div>`;
      return;
    }

    const devices = Array.isArray(res.data?.devices) ? res.data.devices : [];
    this._renderScanResults(devices, wrap);
  }

  _renderScanResults(devices, wrap) {
    if (devices.length === 0) {
      wrap.innerHTML = '<div class="cm-empty">No se encontraron cámaras en la red</div>';
      return;
    }

    const addedIps = new Set(this._cameras.map(c => c.ip));
    const rows = devices.map(dev => {
      const ip    = dev.ip || dev.host || "—";
      const mfr   = dev.manufacturer || dev.brand || "—";
      const model = dev.model || "";
      const mac   = dev.mac || "";
      const added = addedIps.has(ip);
      return `
        <div class="cm-row">
          <div class="cm-row-dot ${added ? "on" : "scan"}"></div>
          <div class="cm-row-ch"></div>
          <div class="cm-row-name cm-mono">${esc(ip)}</div>
          <div class="cm-row-brand">${brandBadge(mfr)}</div>
          <div class="cm-row-ip">${esc(model)}</div>
          <div class="cm-row-port cm-mono">${esc(mac)}</div>
          <div class="cm-row-status">
            ${added ? '<span class="cm-pill ok">agregada</span>' : '<span class="cm-pill scan">encontrada</span>'}
          </div>
          <div class="cm-row-actions">
            ${added
              ? `<span class="cm-muted" style="font-size:12px">Ya agregada</span>`
              : `<button class="cm-row-btn edit scan-add" data-ip="${esc(ip)}" data-brand="${esc(mfr.toLowerCase())}">+ Agregar</button>`
            }
          </div>
        </div>`;
    }).join("");

    wrap.innerHTML = `
      <div class="cm-table-head">
        <div></div><div></div>
        <div>IP</div><div>Fabricante</div>
        <div>Modelo</div><div>MAC</div>
        <div>Estado</div><div></div>
      </div>
      <div class="cm-table-rows">${rows}</div>`;

    wrap.querySelectorAll(".scan-add").forEach(btn =>
      btn.addEventListener("click", () => {
        const brand = BRANDS.includes(btn.dataset.brand) ? btn.dataset.brand : "dahua";
        this._openAddModal({ ip: btn.dataset.ip, brand });
      })
    );
  }

  // ─── Destroy ───────────────────────────────────────────────────────────────

  destroy() {
    this.rootEl?.remove();
    this.rootEl = null;
  }
}
