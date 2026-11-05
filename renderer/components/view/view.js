import { POLL_MS } from "../../core/constants.js";

export class ViewModule {
  constructor(rootEl, deps = {}) {
    this.rootEl = rootEl || null;
    this.deps = deps || {};
    this.state = deps.state;
    this.el = deps.el;
    this.kvClientService = deps.kvClientService;
    this.dashboard = deps.dashboard;
    this.bound = false;
    this.currentGroup = null;
    this.launchInitialGroup = this._readLaunchInitialGroup();

    this.handleRefreshGroupsClick = this.handleRefreshGroupsClick.bind(this);
    this.handleRefreshStateClick = this.handleRefreshStateClick.bind(this);
    this.handleDuplicateClick = this.handleDuplicateClick.bind(this);
  }

  mount() {
    this.bindEvents();
  }

  destroy() {
    this.stopPolling();
    if (this.el?.btnRefreshGroups) {
      this.el.btnRefreshGroups.removeEventListener("click", this.handleRefreshGroupsClick);
    }
    if (this.el?.btnRefreshState) {
      this.el.btnRefreshState.removeEventListener("click", this.handleRefreshStateClick);
    }
    if (this.el?.btnDuplicate) {
      this.el.btnDuplicate.removeEventListener("click", this.handleDuplicateClick);
    }
    this.bound = false;
  }

  bindEvents() {
    if (this.bound) return;
    this.el?.btnRefreshGroups?.addEventListener("click", this.handleRefreshGroupsClick);
    this.el?.btnRefreshState?.addEventListener("click", this.handleRefreshStateClick);
    this.el?.btnDuplicate?.addEventListener("click", this.handleDuplicateClick);
    this.bound = true;
  }

  updateClientState(clientState) {
    this.lastClientState = clientState || null;
  }

  _readLaunchInitialGroup() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const value = String(params.get("initialGroup") || "").trim().toLowerCase();
      return value || null;
    } catch (_err) {
      return null;
    }
  }

  hasLaunchInitialGroup() {
    return Boolean(this.launchInitialGroup);
  }

  _parseGrid(layoutValue) {
    const raw = String(layoutValue || "1x1").toLowerCase();
    if (!["1x1", "2x2", "3x3", "4x4"].includes(raw)) {
      return { rows: 1, cols: 1, cells: 1 };
    }
    const m = raw.match(/^(\d+)x(\d+)$/);
    if (!m) return { rows: 1, cols: 1, cells: 1 };
    const rows = Math.max(1, Number(m[1]));
    const cols = Math.max(1, Number(m[2]));
    return { rows, cols, cells: rows * cols };
  }

  renderGroups(groups = this.state.groups) {
    this.el.groupsStrip.innerHTML = "";
    const list = Array.isArray(groups) ? groups : [];
    if (!list.length) {
      const ghost = document.createElement("div");
      ghost.className = "status-pill";
      ghost.textContent = "Sin grupos permitidos";
      this.el.groupsStrip.appendChild(ghost);
      return;
    }
    list.forEach((group) => {
      const btn = document.createElement("button");
      btn.className = `group-btn${this.currentGroup === group.name ? " active" : ""}`;
      btn.type = "button";
      btn.textContent = group.title ? `${group.name} - ${group.title}` : group.name;
      btn.addEventListener("click", () => {
        if (this.currentGroup === group.name && this.state.lastContract) {
          return;
        }
        this.currentGroup = group.name;
        this.state.selectedGroup = group.name;
        void this.loadGroupState(group.name, { announce: true });
      });
      this.el.groupsStrip.appendChild(btn);
    });
  }

  renderContractSummary(contract, stateResp) {
    const channels = Array.isArray(contract?.channels) ? contract.channels : [];
    const layout = contract?.layout?.value || "-";
    const capacity = Number(contract?.layout?.capacity || 0);
    const items = [
      ["Modo", stateResp?.mode || "view"],
      ["Grupo", stateResp?.group || this.currentGroup || this.state.selectedGroup || "-"],
      ["Diseño", layout],
      ["Capacidad", String(capacity > 0 ? capacity : this._parseGrid(layout).cells)],
      ["Canales", String(channels.length)],
      ["Actualización", `${Number(stateResp?.expires_in || 0)}s`]
    ];
    this.el.contractSummary.innerHTML = items.map(([k, v]) => (
      `<div class="kpi"><div class="k">${k}</div><div class="v">${String(v)}</div></div>`
    )).join("");
  }

  renderContractGrid(contract) {
    this.dashboard?.destroy?.();
    if (!contract || typeof contract !== "object") {
      this.el.gridWrap.innerHTML = '<div class="empty-state">No hay contrato cargado.</div>';
      return;
    }

    const layoutInfo = this._parseGrid(contract?.layout?.value);
    const channels = Array.isArray(contract.channels) ? contract.channels : [];
    const streams = Array.isArray(contract.streams) ? contract.streams : [];
    const groupLabel = String(this.currentGroup || this.state.selectedGroup || "Grupo");
    const capacityRaw = Number(contract?.layout?.capacity || 0);
    const totalCells = Number.isFinite(capacityRaw) && capacityRaw > 0 ? Math.floor(capacityRaw) : layoutInfo.cells;
    this.el.gridWrap.style.padding = "10px";

    if (channels.length === 0) {
      this.el.gridWrap.innerHTML = '<div class="empty-state">No hay cámaras en este grupo</div>';
      return;
    }

    const byPosition = new Map();
    channels.forEach((item) => {
      const pos = Number(item?.position);
      const channel = Number(item?.channel);
      if (!Number.isFinite(pos) || !Number.isFinite(channel)) return;
      byPosition.set(pos, { channel, position: pos, name: item?.name || null });
    });

    const streamChannels = new Set();
    streams.forEach((item) => {
      const channel = Number(item?.channel);
      if (Number.isFinite(channel)) {
        streamChannels.add(channel);
      }
    });

    const grid = document.createElement("div");
    grid.className = "grid";
    grid.style.gridTemplateColumns = `repeat(${layoutInfo.cols}, minmax(180px, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${layoutInfo.rows}, minmax(120px, 1fr))`;

    for (let i = 1; i <= totalCells; i += 1) {
      const channelItem = byPosition.get(i);
      const cell = document.createElement("div");
      cell.className = `cell${channelItem ? "" : " empty"}`;
      cell.style.background = "rgba(6, 10, 18, 0.86)";
      cell.style.color = "#ffffff";
      if (!channelItem) {
        cell.innerHTML = `
          <div class="cell-head">
            <div class="badge empty">Pos ${i}</div>
          </div>
          <div class="cell-line">Empty</div>
        `;
        grid.appendChild(cell);
        continue;
      }

      const isReady = streamChannels.size === 0 || streamChannels.has(channelItem.channel);
      cell.dataset.streamReady = isReady ? "1" : "0";
      const camLabel = channelItem.name || `CH ${channelItem.channel}`;
      cell.innerHTML = `
        <div class="cell-head">
          <div class="badge">CH ${channelItem.channel}</div>
          <div class="cell-pos">Pos ${i}</div>
        </div>
        <div class="cell-line"><strong>Grupo:</strong> ${groupLabel}</div>
        <div class="cell-line"><strong>Cámara:</strong> ${camLabel}</div>
        <div class="cell-line"><strong>Estado:</strong> READY</div>
      `;
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "secondary";
      openButton.textContent = "Abrir";
      openButton.style.justifySelf = "start";
      openButton.style.padding = "6px 10px";
      openButton.style.fontSize = "12px";
      openButton.addEventListener("click", () => {
        this.deps.pushToast?.(`Open pendiente para canal ${channelItem.channel}`, "info");
      });
      cell.appendChild(openButton);
      grid.appendChild(cell);
    }

    this.el.gridWrap.innerHTML = "";
    this.el.gridWrap.appendChild(grid);
  }

  renderContract(contract, stateResp) {
    this.renderContractSummary(contract, stateResp);
    this.renderContractGrid(contract);
  }

  clearViewerContract(message) {
    this.state.lastContract = null;
    this.el.contractSummary.innerHTML = "";
    if (message === null) {
      this.el.gridWrap.innerHTML = "";
      return;
    }
    const safeMessage = message === undefined ? "Sin datos" : String(message);
    this.el.gridWrap.innerHTML = `<div class="empty-state">${safeMessage}</div>`;
  }

  async loadGroups(options = {}) {
    const resp = await this.kvClientService.getGroups();
    this.deps.applyWindowStats?.(resp);
    if (!resp.ok) {
      if (resp.error === "invalid_session" || resp.error === "not_logged_in" || resp.error === "client_disabled") {
        await this.deps.onSessionExpired?.(resp.error);
        return { ok: false, reason: "session" };
      }
      this.deps.setGlobalStatus?.(`Error grupos: ${this.deps.formatApiError?.(resp, "groups_error")}`);
      if (!options.silent) {
        this.deps.renderViewerMeta?.(`Error grupos ${resp.error || "-"}`);
      }
      return { ok: false, reason: "api", resp };
    }

    this.state.groups = Array.isArray(resp.groups) ? resp.groups : [];
    const availableNames = new Set(this.state.groups.map((g) => String(g?.name || "").trim().toLowerCase()).filter(Boolean));
    const preferredLaunchGroup = this.launchInitialGroup && availableNames.has(this.launchInitialGroup)
      ? this.launchInitialGroup
      : null;
    if (!this.currentGroup || !availableNames.has(this.currentGroup)) {
      this.currentGroup = preferredLaunchGroup || resp.active_group || this.state.groups[0]?.name || null;
    }
    this.state.selectedGroup = this.currentGroup;
    this.renderGroups(this.state.groups);
    this.deps.renderViewerMeta?.(options.note || null);
    this.deps.setGlobalStatus?.(`Grupos sincronizados (${this.state.groups.length})`);
    return { ok: true, resp };
  }

  async loadGroupState(groupName, options = {}) {
    const target = String(groupName || this.currentGroup || this.state.selectedGroup || "").trim();
    if (!target) {
      this.clearViewerContract("No hay grupo activo permitido.");
      return { ok: false, error: "group_missing" };
    }
    if (this.state.isLoadingState) {
      return { ok: false, error: "busy" };
    }
    this.state.isLoadingState = true;
    try {
      if (options.announce) {
        this.deps.setGlobalStatus?.(`Cargando estado de ${target}...`);
      }
      const resp = await this.kvClientService.getState({ group: target });
      this.deps.applyWindowStats?.(resp);
      if (!resp.ok) {
        if (resp.error === "invalid_session" || resp.error === "not_logged_in" || resp.error === "client_disabled") {
          await this.deps.onSessionExpired?.(resp.error);
          return { ok: false, reason: "session" };
        }
        this.deps.setGlobalStatus?.(`Error estado: ${this.deps.formatApiError?.(resp, "state_error")}`);
        this.deps.renderViewerMeta?.(`Error estado ${resp.error || "-"}`);
        this.clearViewerContract(`No se pudo cargar el estado del grupo '${target}'. Error: ${resp.error || "desconocido"}`);
        return { ok: false, reason: "api", resp };
      }

      this.currentGroup = resp.group || target;
      this.launchInitialGroup = null;
      this.state.selectedGroup = this.currentGroup;
      this.state.client = resp.client || this.state.client;
      this.state.lastContract = resp.contract || null;
      this.renderGroups(this.state.groups);
      this.renderContract(resp.contract, resp);
      this.deps.renderViewerMeta?.(`Refresh ${Number(resp.expires_in || 0)}s`);
      this.deps.setGlobalStatus?.(`Estado actualizado ${this.currentGroup}`);
      return { ok: true, resp };
    } finally {
      this.state.isLoadingState = false;
    }
  }

  async open() {
    if (!this.dashboard?.hasEnabledModule?.("view", this.state.modules)) {
      await this.deps.onRequestEnterDashboard?.("Modulo View no disponible");
      this.deps.pushToast?.("El modulo View no esta asignado al cliente.", "warn", 2600);
      return;
    }
    this.state.activeModuleId = "view";
    this.deps.setViewerControlsMode?.("view");
    this.el.viewerClientLabel.textContent = this.state.client?.label || "Cliente View";
    this.clearViewerContract("Cargando grupos permitidos...");
    this.deps.renderViewerMeta?.("Modulo View");

    const groupsResult = await this.loadGroups({ note: "Modulo View" });
    if (!groupsResult.ok) {
      return;
    }

    if (!this.state.groups.length) {
      this.currentGroup = null;
      this.state.selectedGroup = null;
      this.clearViewerContract("No hay grupos asignados o los grupos asignados no existen en backend.");
      return;
    }

    await this.loadGroupState(this.currentGroup || this.state.selectedGroup || this.state.groups[0].name, { announce: true });
  }

  stopPolling() {
    if (this.state.pollingId) {
      clearInterval(this.state.pollingId);
      this.state.pollingId = null;
    }
  }

  startPolling() {
    this.stopPolling();
    this.state.pollingId = setInterval(async () => {
      if (!this.el.screenViewer.classList.contains("active")) {
        return;
      }
      if (this.state.pollingBusy) {
        return;
      }
      this.state.pollingBusy = true;
      try {
        const clientStateResult = await this.deps.refreshClientState?.({ silent: true, noRender: true });
        if (!clientStateResult?.ok) {
          return;
        }
        if (!clientStateResult.revChanged) {
          return;
        }

        if (this.state.activeModuleId !== "view") {
          this.state.modules = this.dashboard?.update?.(this.state.modules) || this.state.modules;
          this.deps.renderViewerMeta?.("Dashboard actualizado por cambio de revision");
          return;
        }

        if (!this.dashboard?.hasEnabledModule?.("view", this.state.modules)) {
          await this.deps.onRequestEnterDashboard?.("Modulo View removido");
          this.deps.pushToast?.("Modulo View removido. Volviendo a Dashboard.", "warn", 2600);
          return;
        }

        const groupsResult = await this.loadGroups({ silent: true, note: "Revision actualizada" });
        if (!groupsResult.ok) {
          return;
        }
        if (this.currentGroup || this.state.selectedGroup) {
          await this.loadGroupState(this.currentGroup || this.state.selectedGroup);
        } else {
          this.clearViewerContract("No hay grupo activo permitido.");
        }
      } finally {
        this.state.pollingBusy = false;
      }
    }, POLL_MS);
  }

  async handleRefreshGroupsClick() {
    if (this.state.activeModuleId !== "view") {
      await this.deps.refreshClientState?.();
      return;
    }
    this.deps.setGlobalStatus?.("Actualizando grupos...");
    const groupsResult = await this.loadGroups({ note: "Actualizacion manual grupos" });
    if (groupsResult.ok && (this.currentGroup || this.state.selectedGroup)) {
      await this.loadGroupState(this.currentGroup || this.state.selectedGroup);
    }
  }

  async handleRefreshStateClick() {
    if (this.state.activeModuleId !== "view") {
      await this.deps.refreshClientState?.();
      return;
    }
    if (!(this.currentGroup || this.state.selectedGroup)) {
      this.deps.setGlobalStatus?.("No hay grupo activo.");
      return;
    }
    await this.loadGroupState(this.currentGroup || this.state.selectedGroup, { announce: true });
  }

  async handleDuplicateClick() {
    if (this.state.activeModuleId !== "view") {
      this.deps.setGlobalStatus?.("Desacoplar solo disponible en View");
      this.deps.pushToast?.("La ventana desacoplada solo funciona dentro de View.", "warn", 2600);
      return;
    }
    const resp = await this.kvClientService.detachWindow({
      initialGroup: this.currentGroup || this.state.selectedGroup || null
    });
    if (!resp || !resp.ok) {
      this.deps.setGlobalStatus?.(`No se pudo desacoplar: ${resp?.error || "error"}`);
      return;
    }
    this.deps.setGlobalStatus?.("Vista desacoplada");
    this.deps.renderViewerMeta?.("Vista desacoplada");
  }
}
