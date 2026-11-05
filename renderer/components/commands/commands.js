// Commands module — UI para acciones del SDK via API
import { MODULES } from "./commands-data.js";
import { renderResult } from "./commands-renderers.js";
import { AuditExplorer } from "./audit-explorer.js";
import { t } from "../../core/i18n.js";

function escHtml(v) {
  return String(v ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// Título de cada módulo del grid de Comandos — traducible módulo por
// módulo: si no existe la clave todavía para un id dado, t() cae al
// mod.title de siempre (mismo texto de hoy), sin romper nada.
function moduleTitle(mod) {
  return t(`UI.COMMANDS.MODULE.${String(mod.id || "").toUpperCase()}.TITLE`, mod.title);
}

function actionsCountLabel(count) {
  return count === 1
    ? t("UI.COMMANDS.ACTIONS_COUNT_ONE", "{count} acción", { count })
    : t("UI.COMMANDS.ACTIONS_COUNT_MANY", "{count} acciones", { count });
}


export class Commands {
  constructor(mountEl, deps = {}) {
    this.mountEl = mountEl;
    this.api = deps.api || window.kvClient?.apiRequest?.bind(window.kvClient) || null;
    this.onLogout = deps.onLogout || null;
    this.rootEl = null;
    this._busy = false;
    this._activeModule = null;
    this._activeCommand = null;
    this._channels = null;
  }

  mount() {
    const root = document.createElement("div");
    root.className = "cmd-root";
    root.innerHTML = `
      <div class="cmd-header">
        <button class="cmd-back-btn" id="cmd-back">${t("UI.COMMANDS.BACK_BTN", "← Volver")}</button>
        <div>
          <div class="cmd-breadcrumb">
            <span id="cmd-bc-root">${t("UI.COMMANDS.ROOT_TITLE", "Comandos")}</span>
            <span id="cmd-bc-sep" class="cmd-hidden"> / </span>
            <span id="cmd-bc-module" class="cmd-breadcrumb-active"></span>
          </div>
          <div class="cmd-title-bar" id="cmd-title">${t("UI.COMMANDS.ROOT_TITLE", "Comandos")}</div>
        </div>
      </div>
      <div class="cmd-body">
        <div class="cmd-module-grid" id="cmd-modules-view"></div>
        <div class="cmd-content cmd-hidden" id="cmd-commands-view">
          <div class="cmd-list-panel" id="cmd-list"></div>
          <div class="cmd-detail-panel" id="cmd-detail">
            <div class="cmd-detail-empty">
              <div class="cmd-detail-empty-icon">⌨️</div>
              Selecciona un comando
            </div>
          </div>
        </div>
        <div id="cmd-audit-view"></div>
      </div>
    `;

    this.mountEl.appendChild(root);
    this.rootEl = root;
    this.rootEl.querySelector("#cmd-back").addEventListener("click", () => this._goBack());
    this._renderModuleGrid();
  }

  // ── Nivel 1: grid de módulos ─────────────────────────────────────────────

  _renderModuleGrid() {
    const grid = this.rootEl.querySelector("#cmd-modules-view");
    grid.innerHTML = MODULES.map(mod => `
      <div class="cmd-module-card" data-mod="${escHtml(mod.id)}">
        <div class="cmd-module-icon">${mod.icon}</div>
        <div class="cmd-module-name">${escHtml(moduleTitle(mod))}</div>
        <div class="cmd-module-count">${escHtml(actionsCountLabel(mod.commands.length))}</div>
      </div>
    `).join("");

    grid.querySelectorAll(".cmd-module-card").forEach(card => {
      card.addEventListener("click", () => {
        const mod = MODULES.find(m => m.id === card.dataset.mod);
        if (mod) this._enterModule(mod);
      });
    });
  }

  // ── Nivel 2: lista de acciones + panel de detalle ────────────────────────

  _enterModule(mod) {
    this._activeModule = mod;
    this._activeCommand = null;

    const title = moduleTitle(mod);
    this.rootEl.querySelector("#cmd-bc-sep").classList.remove("cmd-hidden");
    this.rootEl.querySelector("#cmd-bc-module").textContent = title;
    this.rootEl.querySelector("#cmd-title").textContent = `${mod.icon} ${title}`;
    this.rootEl.querySelector("#cmd-back").classList.add("visible");

    this.rootEl.querySelector("#cmd-modules-view").classList.add("cmd-hidden");

    if (mod.id === "audit") {
      this._enterAuditExplorer(mod);
      return;
    }
    if (mod.id === "calc") {
      this._enterCalcPanel(mod);
      return;
    }
    if (mod.id === "client") {
      this._enterSessionPanel(mod);
      return;
    }
    if (mod.id === "usage") {
      this._enterUsagePanel(mod);
      return;
    }

    this.rootEl.querySelector("#cmd-commands-view").classList.remove("cmd-hidden");
    this._renderCommandList(mod);
    this._showDetailEmpty();
  }

  _enterAuditExplorer(mod) {
    this._destroyAuditExplorer();
    const auditView = this.rootEl.querySelector("#cmd-audit-view");
    if (!auditView) return;
    auditView.classList.add("audit-active");
    this._auditExplorer = new AuditExplorer(auditView, this.api);
    this._auditExplorer.mount();
  }

  _enterCalcPanel(mod) {
    import("../../components/calc/calc.js").then(({ CalcPanel }) => {
      this._activeCalc?.destroy?.();
      const view = this.rootEl.querySelector("#cmd-audit-view");
      if (!view) return;
      view.classList.add("audit-active");
      this._activeCalc = new CalcPanel(view, this.api);
      this._activeCalc.mount();
    });
  }

  _enterSessionPanel(mod) {
    import("../../components/session-panel/session-panel.js").then(({ SessionPanel }) => {
      this._activeSession?.destroy?.();
      const view = this.rootEl.querySelector("#cmd-audit-view");
      if (!view) return;
      view.classList.add("audit-active");
      this._activeSession = new SessionPanel(view, { api: this.api, onLoggedOut: this.onLogout });
      this._activeSession.mount();
    });
  }

  _enterUsagePanel(mod) {
    import("../../components/usage/usage.js").then(({ UsagePanel }) => {
      this._activeUsage?.destroy?.();
      const view = this.rootEl.querySelector("#cmd-audit-view");
      if (!view) return;
      view.classList.add("audit-active");
      this._activeUsage = new UsagePanel(view, this.api);
      this._activeUsage.mount();
    });
  }

  _destroyAuditExplorer() {
    if (this._auditExplorer) {
      this._auditExplorer.destroy();
      this._auditExplorer = null;
    }
    if (this._activeCalc) {
      this._activeCalc.destroy();
      this._activeCalc = null;
    }
    if (this._activeSession) {
      this._activeSession.destroy();
      this._activeSession = null;
    }
    if (this._activeUsage) {
      this._activeUsage.destroy();
      this._activeUsage = null;
    }
    const auditView = this.rootEl?.querySelector("#cmd-audit-view");
    if (auditView) {
      auditView.classList.remove("audit-active");
      auditView.innerHTML = "";
    }
  }

  _renderCommandList(mod) {
    const list = this.rootEl.querySelector("#cmd-list");
    list.innerHTML = mod.commands.map(cmd => `
      <div class="cmd-item" data-cmd="${escHtml(cmd.id)}">
        <span class="cmd-item-title">${escHtml(cmd.title)}</span>
        <span class="cmd-item-desc">${escHtml(cmd.desc || "")}</span>
      </div>
    `).join("");

    list.querySelectorAll(".cmd-item").forEach(item => {
      item.addEventListener("click", () => {
        const cmd = mod.commands.find(c => c.id === item.dataset.cmd);
        if (!cmd) return;
        list.querySelectorAll(".cmd-item").forEach(i => i.classList.remove("active"));
        item.classList.add("active");
        this._activeCommand = cmd;
        this._renderForm(cmd);
      });
    });
  }

  _showDetailEmpty() {
    this.rootEl.querySelector("#cmd-detail").innerHTML = `
      <div class="cmd-detail-empty">
        <div class="cmd-detail-empty-icon">⌨️</div>
        Selecciona un comando
      </div>
    `;
  }

  // ── Nivel 3: formulario dinámico ────────────────────────────────────────

  _renderForm(cmd, presetChannel = null) {
    const detail = this.rootEl.querySelector("#cmd-detail");

    const fieldsHtml = (cmd.fields || []).map(f => this._renderField(f)).join("");
    const actionLabel = escHtml(cmd.actionLabel || "Ejecutar");

    detail.innerHTML = `
      <div class="cmd-form-wrap">
        <div class="cmd-form-header">
          <div class="cmd-form-header-left">
            <div class="cmd-form-title">${escHtml(cmd.title)}</div>
          </div>
          <div class="cmd-form-header-right">
            <button class="cmd-clear-btn" id="cmd-clear-out">Limpiar</button>
            <button class="cmd-run-btn" id="cmd-run-btn">▶ ${actionLabel}</button>
          </div>
        </div>
        <div class="cmd-form-desc">${escHtml(cmd.desc)}</div>
        ${cmd.showChannelState ? `<div class="cmd-ch-state-block" id="cmd-ch-state"><span class="cmd-cs-idle">Selecciona una cámara para ver su configuración actual</span></div>` : ""}
        ${fieldsHtml ? `<div class="cmd-fields">${fieldsHtml}</div>` : ""}
      </div>
      <div class="cmd-result-wrap" id="cmd-result">
        <div class="cmd-result-placeholder">Sin resultado — presiona ${actionLabel}</div>
      </div>
    `;

    detail.querySelector("#cmd-run-btn").addEventListener("click", () => this._executeCommand(cmd));
    detail.querySelector("#cmd-clear-out").addEventListener("click", () => this._clearResult());

    // Pre-llenar canal cuando llega desde el wizard y el campo es un input plano
    if (presetChannel != null) {
      const plainChannelInput = detail.querySelector('input[data-key="channel"]');
      if (plainChannelInput) plainChannelInput.value = String(presetChannel);
    }

    detail.querySelectorAll(".cmd-folder-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Abriendo…";
        try {
          const result = await window.kvClient?.pickFolder?.();
          if (result?.ok && result.path) {
            const input = detail.querySelector(`input[data-key="${btn.dataset.for}"]`);
            if (input) { input.value = result.path; input.dispatchEvent(new Event("input")); }
          }
        } finally {
          btn.disabled = false;
          btn.textContent = "📂 Elegir carpeta";
        }
      });
    });

    void this._populateChannelSelects(detail, cmd, presetChannel);
  }

  _renderField(f) {
    const req = f.required ? '<span class="req">*</span>' : "";
    const hint = f.hint ? `<div class="cmd-field-hint">${escHtml(f.hint)}</div>` : "";

    if (f.type === "checkbox") {
      const checked = f.default ? "checked" : "";
      return `
        <div class="cmd-field cmd-field-check">
          <label class="cmd-check-label">
            <input type="checkbox" data-key="${escHtml(f.key)}" ${checked}>
            <span>${escHtml(f.label)}</span>
          </label>
          ${hint}
        </div>
      `;
    }

    if (f.type === "select") {
      const opts = (f.options || []).map(o =>
        `<option value="${escHtml(o)}"${o === f.default ? " selected" : ""}>${escHtml(o)}</option>`
      ).join("");
      return `
        <div class="cmd-field">
          <label class="cmd-field-label" for="f-${escHtml(f.key)}">${escHtml(f.label)}${req}</label>
          <select id="f-${escHtml(f.key)}" data-key="${escHtml(f.key)}">${opts}</select>
          ${hint}
        </div>
      `;
    }

    if (f.type === "percent") {
      const amount = f.default !== undefined ? `value="${escHtml(f.default)}"` : "";
      return `
        <div class="cmd-field">
          <label class="cmd-field-label" for="f-${escHtml(f.key)}">${escHtml(f.label)}${req}</label>
          <div class="cmd-percent-wrap">
            <input type="number" id="f-${escHtml(f.key)}" data-key="${escHtml(f.key)}" min="1" max="99" step="1" ${amount}>
            <span class="cmd-percent-suffix">%</span>
          </div>
          ${hint}
        </div>
      `;
    }

    if (f.type === "size") {
      const amount = f.default !== undefined ? `value="${escHtml(f.default)}"` : "";
      const unit = f.defaultUnit === "TB" ? "TB" : "GB";
      return `
        <div class="cmd-field">
          <label class="cmd-field-label" for="f-${escHtml(f.key)}">${escHtml(f.label)}${req}</label>
          <div class="cmd-size-wrap">
            <input type="number" id="f-${escHtml(f.key)}" data-key="${escHtml(f.key)}" min="1" step="1" ${amount}>
            <select data-key="${escHtml(f.key)}__unit">
              <option value="GB"${unit === "GB" ? " selected" : ""}>GB</option>
              <option value="TB"${unit === "TB" ? " selected" : ""}>TB</option>
            </select>
          </div>
          ${hint}
        </div>
      `;
    }

    if (f.type === "folder") {
      const placeholder = f.placeholder ? `placeholder="${escHtml(f.placeholder)}"` : "";
      return `
        <div class="cmd-field">
          <label class="cmd-field-label" for="f-${escHtml(f.key)}">${escHtml(f.label)}${req}</label>
          <div class="cmd-folder-wrap">
            <input type="text" id="f-${escHtml(f.key)}" data-key="${escHtml(f.key)}" data-folder="1" ${placeholder} autocomplete="off">
            <button type="button" class="cmd-folder-btn" data-for="${escHtml(f.key)}">📂 Elegir carpeta</button>
          </div>
          ${hint}
        </div>
      `;
    }

    if (f.type === "channel-select" || f.type === "channel-select-optional") {
      const attr = f.type === "channel-select" ? "required" : "optional";
      return `
        <div class="cmd-field">
          <label class="cmd-field-label" for="f-${escHtml(f.key)}">${escHtml(f.label)}${req}</label>
          <select id="f-${escHtml(f.key)}" data-key="${escHtml(f.key)}" data-channel-select="${attr}">
            <option value="">Cargando cámaras…</option>
          </select>
          ${hint}
        </div>
      `;
    }

    const inputType = f.type === "password" ? "password" : f.type === "number" ? "number" : "text";
    const placeholder = f.placeholder ? `placeholder="${escHtml(f.placeholder)}"` : "";
    const value = f.default !== undefined ? `value="${escHtml(f.default)}"` : "";

    return `
      <div class="cmd-field">
        <label class="cmd-field-label" for="f-${escHtml(f.key)}">${escHtml(f.label)}${req}</label>
        <input type="${inputType}" id="f-${escHtml(f.key)}" data-key="${escHtml(f.key)}" ${placeholder} ${value}>
        ${hint}
      </div>
    `;
  }

  // ── Ejecución ────────────────────────────────────────────────────────────

  async _executeCommand(cmd) {
    if (this._busy) return;

    const detail = this.rootEl?.querySelector("#cmd-detail");
    if (!detail) return;

    // Recoger valores del formulario
    const formData = {};
    (cmd.fields || []).forEach(f => {
      const el = detail.querySelector(`[data-key="${f.key}"]`);
      if (!el) return;
      if (f.type === "checkbox") {
        formData[f.key] = el.checked;
      } else if (f.type === "percent") {
        const v = el.value.trim();
        formData[f.key] = v === "" ? undefined : `${v}%`;
      } else if (f.type === "size") {
        const amount = el.value.trim();
        const unitEl = detail.querySelector(`[data-key="${f.key}__unit"]`);
        const unit = unitEl?.value || "GB";
        formData[f.key] = amount === "" ? undefined : `${amount}${unit}`;
      } else if (f.type === "number" || f.type === "channel-select" || f.type === "channel-select-optional") {
        const v = el.value.trim();
        formData[f.key] = v === "" ? undefined : Number(v);
      } else {
        const v = el.value.trim();
        formData[f.key] = v === "" ? undefined : v;
      }
    });

    // Validar campos requeridos
    for (const f of (cmd.fields || [])) {
      if (f.required && (formData[f.key] === undefined || formData[f.key] === "")) {
        this._showResultNode(
          (() => { const e = document.createElement("div"); e.className = "cmd-result-error"; e.innerHTML = `<span class="cmd-err-icon">✗</span> Campo requerido: ${f.label}`; return e; })(),
          false, 0
        );
        return;
      }
    }

    // Validar rango de campos "percent" (el input permite escribir fuera de min/max a mano)
    for (const f of (cmd.fields || [])) {
      if (f.type !== "percent" || formData[f.key] === undefined) continue;
      const n = parseFloat(formData[f.key]);
      if (!Number.isFinite(n) || n <= 0 || n >= 100) {
        this._showResultNode(
          (() => { const e = document.createElement("div"); e.className = "cmd-result-error"; e.innerHTML = `<span class="cmd-err-icon">✗</span> ${f.label} debe estar entre 1% y 99%`; return e; })(),
          false, 0
        );
        return;
      }
    }

    // Regla de negocio: en FIFO, "liberar hasta" debe ser menor que "activar al llegar a"
    // (el borrado debe bajar el uso por debajo del umbral que lo disparó).
    if (cmd.id === "quota.overwrite.set" || cmd.id === "quota.overwrite.change") {
      const threshold = parseFloat(formData.threshold);
      const target = parseFloat(formData.target);
      if (Number.isFinite(threshold) && Number.isFinite(target) && target >= threshold) {
        this._showResultNode(
          (() => { const e = document.createElement("div"); e.className = "cmd-result-error"; e.innerHTML = `<span class="cmd-err-icon">✗</span> El objetivo debe ser menor que el umbral (ej: umbral 95%, objetivo 90%)`; return e; })(),
          false, 0
        );
        return;
      }
    }

    // Construir path, query y body
    let path = cmd.pathTemplate || cmd.path;
    const query = {};
    const body = {};

    (cmd.fields || []).forEach(f => {
      const val = formData[f.key];
      if (val === undefined) return;

      if (f.pathParam) {
        path = path.replace(`{${f.key}}`, encodeURIComponent(String(val)));
      } else if (f.queryParam || cmd.method === "GET") {
        query[f.key] = val;
      } else {
        body[f.key] = val;
      }
    });

    this._busy = true;
    const runBtn = detail.querySelector("#cmd-run-btn");
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = "⟳ Ejecutando…"; }

    this._showResultLoading();

    const res = await this._req(
      cmd.method,
      path,
      cmd.method !== "GET" && Object.keys(body).length ? body : undefined,
      Object.keys(query).length ? query : undefined
    );

    this._busy = false;
    if (runBtn) { runBtn.disabled = false; runBtn.textContent = `▶ ${cmd.actionLabel || "Ejecutar"}`; }

    this._showResultNode(renderResult(cmd.id, res.data, res.ok, { api: this.api }), res.ok, res.status);
    if (res.ok && (cmd.id === "camera.add" || cmd.id === "camera.remove")) {
      this._channels = null;
    }

    if (cmd.wizardNext) {
      const channel = this._resolveWizardChannel(cmd, formData, res.data);
      const alreadyDone = !res.ok && this._isAlreadyDoneError(res);
      if (channel != null && (res.ok || alreadyDone)) {
        this._appendWizardBanner(cmd.wizardNext, channel, alreadyDone);
      }
    }
  }

  // ── Wizard: enlace al siguiente paso sugerido ───────────────────────────

  _resolveWizardChannel(cmd, formData, resData) {
    if (cmd.id === "camera.add") {
      return resData?.channel ?? formData.channel ?? null;
    }
    return formData.channel ?? null;
  }

  // El backend responde con mensajes tipo "storage already assigned for
  // channel", "quota already exists for channel X", "already initialized",
  // "channel already exists" cuando el paso ya estaba hecho. En esos casos
  // el error es informativo, no bloqueante — el wizard debe poder avanzar.
  _isAlreadyDoneError(res) {
    const msg = String(res?.data?.message || res?.data?.detail || res?.data?.error || "").toLowerCase();
    return msg.includes("already");
  }

  _appendWizardBanner(nextRef, channel, alreadyDone = false) {
    const wrap = this.rootEl?.querySelector("#cmd-result");
    if (!wrap) return;
    const nextMod = MODULES.find(m => m.id === nextRef.moduleId);
    const nextCmd = nextMod?.commands.find(c => c.id === nextRef.commandId);
    if (!nextMod || !nextCmd) return;

    const intro = alreadyDone
      ? `Este paso ya estaba configurado para <strong>Canal ${escHtml(String(channel))}</strong>. Continúa con:`
      : `Siguiente paso sugerido para <strong>Canal ${escHtml(String(channel))}</strong>:`;

    const banner = document.createElement("div");
    banner.className = "cmd-wizard-banner" + (alreadyDone ? " cmd-wizard-banner-info" : "");
    banner.innerHTML = `
      <div class="cmd-wizard-text">
        <span class="cmd-wizard-icon">→</span>
        ${intro} ${escHtml(nextCmd.title)}
      </div>
      <div class="cmd-wizard-actions">
        <button class="cmd-wizard-skip" type="button">Omitir</button>
        <button class="cmd-wizard-next" type="button">Continuar →</button>
      </div>
    `;
    banner.querySelector(".cmd-wizard-skip").addEventListener("click", () => banner.remove());
    banner.querySelector(".cmd-wizard-next").addEventListener("click", () => {
      this._goToWizardStep(nextMod, nextCmd, channel);
    });
    wrap.appendChild(banner);
  }

  _goToWizardStep(mod, cmd, channel) {
    this._enterModule(mod);
    const list = this.rootEl.querySelector("#cmd-list");
    list?.querySelectorAll(".cmd-item").forEach(i => i.classList.remove("active"));
    list?.querySelector(`.cmd-item[data-cmd="${cmd.id}"]`)?.classList.add("active");
    this._activeCommand = cmd;
    this._renderForm(cmd, channel);
  }

  // ── Result ───────────────────────────────────────────────────────────────

  _showResultLoading() {
    const wrap = this.rootEl?.querySelector("#cmd-result");
    if (!wrap) return;
    wrap.innerHTML = '<div class="cmd-result-loading"><span class="cmd-spinning">⟳</span> Ejecutando…</div>';
  }

  _showResultNode(node, ok, status) {
    const wrap = this.rootEl?.querySelector("#cmd-result");
    if (!wrap) return;
    wrap.innerHTML = "";
    const statusBar = document.createElement("div");
    statusBar.className = "cmd-result-status " + (ok ? "ok" : "err");
    statusBar.textContent = ok ? `✓ ${status} OK` : `✗ ${status || 0} Error`;
    wrap.appendChild(statusBar);
    wrap.appendChild(node);
    wrap.scrollTop = 0;
  }

  _clearResult() {
    const wrap = this.rootEl?.querySelector("#cmd-result");
    if (!wrap) return;
    wrap.innerHTML = '<div class="cmd-result-placeholder">Sin resultado — presiona Ejecutar</div>';
  }

  // ── Navegación ───────────────────────────────────────────────────────────

  _goBack() {
    this._activeModule = null;
    this._activeCommand = null;

    this.rootEl.querySelector("#cmd-bc-sep").classList.add("cmd-hidden");
    this.rootEl.querySelector("#cmd-bc-module").textContent = "";
    this.rootEl.querySelector("#cmd-title").textContent = "Comandos";
    this.rootEl.querySelector("#cmd-back").classList.remove("visible");

    this.rootEl.querySelector("#cmd-commands-view").classList.add("cmd-hidden");
    this._destroyAuditExplorer();
    this.rootEl.querySelector("#cmd-modules-view").classList.remove("cmd-hidden");
  }

  // ── Canal: carga de cámaras y estado ─────────────────────────────────────

  async _loadChannels() {
    if (this._channels) return this._channels;
    try {
      const res = await this._req("GET", "/camera/list");
      this._channels = (res.ok && Array.isArray(res.data)) ? res.data : [];
    } catch(_) { this._channels = []; }
    return this._channels;
  }

  async _populateChannelSelects(container, cmd, presetChannel = null) {
    const selects = container.querySelectorAll("select[data-channel-select]");
    if (!selects.length) return;
    const channels = await this._loadChannels();
    selects.forEach(sel => {
      const isOptional = sel.dataset.channelSelect === "optional";
      sel.innerHTML = (isOptional
        ? '<option value="">Todas las cámaras</option>'
        : '<option value="">Seleccionar cámara…</option>') +
        channels.map(ch => {
          const name = ch.name || ch.ip;
          const label = `CH${ch.channel} — ${name}  (${ch.ip})`;
          return `<option value="${escHtml(String(ch.channel))}">${escHtml(label)}</option>`;
        }).join("");
      if (!isOptional && channels.length === 1) {
        sel.value = String(channels[0].channel);
      }
      if (presetChannel != null && channels.some(c => String(c.channel) === String(presetChannel))) {
        sel.value = String(presetChannel);
      }
    });
    if (cmd.showChannelState) {
      const primarySel =
        container.querySelector("select[data-channel-select='required']") ||
        container.querySelector("select[data-channel-select]");
      if (primarySel) {
        primarySel.addEventListener("change", () => {
          const v = primarySel.value;
          const block = this.rootEl?.querySelector("#cmd-ch-state");
          if (!v) {
            if (block) block.innerHTML = '<span class="cmd-cs-idle">Selecciona una cámara para ver su configuración actual</span>';
            return;
          }
          void this._loadChannelState(v);
        });
        if (primarySel.value) void this._loadChannelState(primarySel.value);
      }
    }
  }

  async _loadChannelState(channelId) {
    const block = this.rootEl?.querySelector("#cmd-ch-state");
    if (!block) return;
    block.innerHTML = '<span class="cmd-cs-loading">Cargando estado actual…</span>';
    try {
      const res = await this._req("GET", "/channel/status", undefined, { channel: channelId });
      if (!res.ok) throw new Error(res.data?.error || "error");
      const all = res.data?.channels || (Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []));
      const ch = all.find(c => String(c.channel) === String(channelId)) || all[0];
      if (!ch) { block.innerHTML = '<span class="cmd-cs-empty">Sin datos para este canal</span>'; return; }
      this._renderChannelStateBlock(block, ch);
    } catch(_) {
      block.innerHTML = '<span class="cmd-cs-err">No se pudo cargar el estado del canal</span>';
    }
  }

  _renderChannelStateBlock(block, ch) {
    const fmtB = b => {
      if (b == null) return "—";
      if (b >= 1e12) return (b/1e12).toFixed(2)+" TB";
      if (b >= 1e9)  return (b/1e9).toFixed(1)+" GB";
      if (b >= 1e6)  return (b/1e6).toFixed(0)+" MB";
      return (b/1e3).toFixed(0)+" KB";
    };
    const q   = ch.quota             || {};
    const qm  = ch.quota_mode        || {};
    const rec = ch.recording_runtime || {};
    const rows = [];

    if (rec.active !== undefined) {
      const on = Boolean(rec.active);
      rows.push(`<div class="cmd-cs-row"><span class="cmd-cs-key">Grabación</span><span class="cmd-cs-val ${on ? "cmd-cs-ok" : "cmd-cs-off"}">${on ? "● Activa" : "○ Inactiva"}</span></div>`);
    }
    if (q.assigned && q.limit_bytes) {
      rows.push(`<div class="cmd-cs-row"><span class="cmd-cs-key">Cuota asignada</span><span class="cmd-cs-val">${escHtml(q.limit_human || fmtB(q.limit_bytes))}</span></div>`);
    } else {
      rows.push(`<div class="cmd-cs-row"><span class="cmd-cs-key">Cuota</span><span class="cmd-cs-val cmd-cs-muted">Sin asignar</span></div>`);
    }
    if (qm.policy_configured !== undefined) {
      let txt, cls;
      if (!qm.policy_configured)   { txt = "Sin configurar"; cls = "cmd-cs-muted"; }
      else if (qm.active)          { txt = `Activo — umbral ${escHtml(String(qm.threshold_percent))}%`; cls = "cmd-cs-warn"; }
      else                         { txt = `Configurado — umbral ${escHtml(String(qm.threshold_percent))}%, libera a ${escHtml(String(qm.target_percent))}%`; cls = ""; }
      rows.push(`<div class="cmd-cs-row"><span class="cmd-cs-key">Reciclado (FIFO)</span><span class="cmd-cs-val ${cls}">${txt}</span></div>`);
    }
    if (ch.storage_path) {
      rows.push(`<div class="cmd-cs-row"><span class="cmd-cs-key">Carpeta</span><span class="cmd-cs-val cmd-cs-mono">${escHtml(ch.storage_path)}</span></div>`);
    }

    if (!rows.length) { block.innerHTML = '<span class="cmd-cs-empty">Sin configuración registrada</span>'; return; }
    block.innerHTML = `<div class="cmd-cs-header">Estado actual — Canal ${escHtml(String(ch.channel))}</div>${rows.join("")}`;
  }

  // ── API ──────────────────────────────────────────────────────────────────

  async _req(method, path, body, query) {
    if (!this.api) return { ok: false, status: 0, data: { error: "no_api" } };
    try {
      return await this.api({ method, path, body, query });
    } catch (err) {
      return { ok: false, status: 0, data: { error: err.message || String(err) } };
    }
  }

  destroy() {
    this._destroyAuditExplorer();
    this.rootEl?.remove();
    this.rootEl = null;
  }
}
