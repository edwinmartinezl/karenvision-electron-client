import { KV_DEBUG_HUD, prefersReducedMotion } from "../core/constants.js";
import { state, setWindowFrameState } from "../core/state-store.js";
import { bootstrapTranslations } from "../core/i18n.js";
import { el, uiComponents } from "../core/dom-refs.js";
import { createScreenRouter } from "../core/screen-router.js";
import { windowControlsService } from "../services/window-controls-service.js";
import { Dashboard } from "../components/dashboard/dashboard.js";
import { ConnectionPanel } from "../components/connection-panel/connection-panel.js";
import { LoginPanel } from "../components/login-panel/login-panel.js";
import { ToastStack } from "../components/toast-stack/toast-stack.js";
import { ModulesNavbar } from "../components/modules-navbar/modules-navbar.js";

export function initApp() {
  const IS_FRONTEND_ONLY_NAV = false;

  const _urlParams          = new URLSearchParams(window.location.search || "");
  const IS_DETACH_MODE      = _urlParams.get("mode") === "detach";
  const DETACH_INITIAL_GROUP = String(_urlParams.get("initialGroup") || "").trim().toLowerCase() || null;

  if (IS_DETACH_MODE) {
    document.documentElement.classList.add("detach-mode");
  }

  document.getElementById("btn-close").addEventListener("click", () => windowControlsService.close());
  document.getElementById("btn-max").addEventListener("click", () => windowControlsService.maximize());
  document.getElementById("btn-min").addEventListener("click", () => windowControlsService.minimize());

  // Se dispara en paralelo con el resto de boot() (autodiscover, restore de
  // sesión) — boot() espera esta promesa antes de destapar el overlay de
  // arranque, para que ningún módulo pueda montarse con traducciones a
  // medio cargar y mostrar el fallback por una fracción de segundo.
  const _translationsReady = bootstrapTranslations().catch(() => {});

  function applyWindowFrameState(payload) {
    const maximized = Boolean(payload && payload.maximized);
    const fullscreen = Boolean(payload && payload.fullscreen);
    const edgeToEdge = maximized || fullscreen;
    setWindowFrameState({ maximized, fullscreen });
    document.documentElement.classList.toggle("window-maximized", edgeToEdge);
    document.body.classList.toggle("window-maximized", edgeToEdge);
    if (el.btnMax) {
      el.btnMax.setAttribute("aria-label", maximized ? "Restaurar" : "Maximizar");
    }
  }

  windowControlsService.onStateChange(applyWindowFrameState);
  Promise.resolve(windowControlsService.getState?.())
    .then((payload) => applyWindowFrameState(payload || {}))
    .catch(() => {});

  if (KV_DEBUG_HUD) {
    console.debug("[KV][ui] components", Object.fromEntries(
      Object.entries(uiComponents).map(([name, node]) => [name, Boolean(node)])
    ));
  }
  const toastStack = new ToastStack(el.toastStack);
  toastStack.mount();

  let viewModule = null;
  let dashboardCleanHost = null;
  let viewRootHost = null;
  let activeViewerPane = null;
  const screenRouter = createScreenRouter({
    state,
    el,
    prefersReducedMotion,
    onLeaveViewer: () => viewModule?.stopPolling?.()
  });
  const { setScreen, animateScreenTransition } = screenRouter;
  const dashboard = new Dashboard(el.gridWrap, {
    state,
    debugHudEnabled: KV_DEBUG_HUD,
    setViewerControlsMode,
    renderViewerMeta,
    prepareViewerBodyForDashboard: () => {
      if (el.viewerBody) {
        el.viewerBody.style.display = "grid";
        el.viewerBody.style.gridTemplateRows = "1fr";
        el.viewerBody.style.minHeight = "0";
        el.viewerBody.style.overflow = "hidden";
      }
    },
    onOpenModule: (moduleCard) => enterModule(moduleCard),
    onOpenViewModule: () => enterModule({ id: "view", title: "View" }),
    onUnsupportedModule: (moduleId) => {
      toastStack.push(`Modulo '${moduleId}' disponible en dashboard, UI aun no implementada.`, { type: "info", durationMs: 2600 });
    }
  });

  const modulesNavbar = new ModulesNavbar({
    mountEl: el.chromeBar,
    deps: {
      onModuleClick: async (moduleId) => {
        const normalizedId = String(moduleId || "").trim().toLowerCase();
        if (!normalizedId) return;
        if (!dashboard.hasEnabledModule(normalizedId, state.modules)) {
          return;
        }
        if (normalizedId === "view") {
          await viewModule?.open?.();
          return;
        }
        toastStack.push(`Modulo '${normalizedId}' disponible en dashboard, UI aun no implementada.`, { type: "info", durationMs: 2600 });
      },
      hasEnabledModule: (moduleId) => dashboard.hasEnabledModule(moduleId, state.modules)
    }
  });
  modulesNavbar.mount();

  function setBreadcrumb(pathArray) {
    if (!el.status) {
      return;
    }
    const items = (Array.isArray(pathArray) ? pathArray : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (!items.length) {
      el.status.classList.remove("breadcrumb-container");
      el.status.textContent = "";
      return;
    }

    el.status.classList.add("breadcrumb-container");
    el.status.innerHTML = "";

    items.forEach((label, index) => {
      const isLast = index === items.length - 1;
      if (isLast) {
        const activeEl = document.createElement("span");
        activeEl.className = "breadcrumb-item breadcrumb-active";
        activeEl.textContent = label;
        el.status.appendChild(activeEl);
        return;
      }

      const itemEl = document.createElement("button");
      itemEl.type = "button";
      itemEl.className = "breadcrumb-item";
      itemEl.textContent = label;
      itemEl.addEventListener("click", () => {
        if (label === "Dashboard") {
          void enterDashboard("Dashboard", { forceUiOnlyLocal: true, noPolling: true });
        }
      });
      el.status.appendChild(itemEl);

      const separatorEl = document.createElement("span");
      separatorEl.className = "breadcrumb-separator";
      separatorEl.setAttribute("aria-hidden", "true");
      separatorEl.textContent = "›";
      el.status.appendChild(separatorEl);
    });
  }

  function ensureCleanDashboardHost() {
    const viewerBody = uiComponents.viewerBody || el.viewerBody || null;
    if (!viewerBody) {
      return null;
    }

    if (dashboard.rootEl && dashboard.rootEl !== dashboardCleanHost) {
      dashboard.destroy?.();
    }

    if (el.gridWrap && el.gridWrap.isConnected) {
      el.gridWrap.remove();
    }
    if (uiComponents.dashboardGrid && uiComponents.dashboardGrid.isConnected) {
      uiComponents.dashboardGrid.remove();
    }

    if (!dashboardCleanHost || !dashboardCleanHost.isConnected) {
      dashboardCleanHost = document.createElement("div");
      dashboardCleanHost.id = "dashboard-clean-host";
      dashboardCleanHost.setAttribute("data-component", "dashboard-clean-host");
      dashboardCleanHost.classList.add("screen", "viewer-pane");
      viewerBody.appendChild(dashboardCleanHost);
    }

    dashboard.rootEl = dashboardCleanHost;
    dashboardCleanHost.innerHTML = "";
    return dashboardCleanHost;
  }

  function ensureViewRootHost() {
    const viewerBody = uiComponents.viewerBody || el.viewerBody || null;
    if (!viewerBody) {
      return null;
    }
    if (!viewRootHost || !viewRootHost.isConnected) {
      viewRootHost = document.createElement("div");
      viewRootHost.className = "view-root screen viewer-pane";
      viewRootHost.setAttribute("data-component", "viewer-view-root");
      viewerBody.appendChild(viewRootHost);
    }
    return viewRootHost;
  }

  function setViewerPaneActive(paneName) {
    activeViewerPane = paneName || null;
    dashboardCleanHost?.classList?.toggle("active", paneName === "dashboard");
    viewRootHost?.classList?.toggle("active", paneName === "view");
  }

  function transitionViewerPane(nextPaneName) {
    const nextPane = nextPaneName === "view" ? "view" : "dashboard";
    const fromNode = activeViewerPane === "view"
      ? viewRootHost
      : (activeViewerPane === "dashboard" ? dashboardCleanHost : null);
    const toNode = nextPane === "view" ? viewRootHost : dashboardCleanHost;
    if (!toNode) {
      activeViewerPane = nextPane;
      return;
    }
    if (!fromNode || fromNode === toNode) {
      setViewerPaneActive(nextPane);
      return;
    }
    animateScreenTransition(fromNode, toNode, nextPane === "view" ? 1 : -1);
    activeViewerPane = nextPane;
  }

  function setGlobalStatus(text) {
    const explicitText = String(text || "").trim();
    const moduleLabel = state.activeModuleId === "view"
      ? "View"
      : (state.activeModuleId ? String(state.activeModuleId).replace(/[_-]+/g, " ") : "Dashboard");
    if (el.status) {
      el.status.classList.remove("breadcrumb-container");
      el.status.textContent = explicitText || moduleLabel;
    }
  }

  function setMessage(_node, text, type) {
    const value = String(text || "").trim();
    if (!value) {
      return;
    }
    toastStack.push(value, { type: type || "info" });
  }

  function syncModulesNavbar(modules = state.modules) {
    modulesNavbar.update(Array.isArray(modules) ? modules : []);
    modulesNavbar.setActive(state.activeModuleId);
  }

  function clearNavigationRoots() {
    const root = dashboard.rootEl || dashboardCleanHost || el.gridWrap || null;
    if (root) {
      root.innerHTML = "";
    }
    if (el.gridWrap && el.gridWrap !== root) {
      el.gridWrap.innerHTML = "";
    }
    if (el.contractSummary) {
      el.contractSummary.innerHTML = "";
    }
    if (el.groupsStrip) {
      el.groupsStrip.innerHTML = "";
    }
    if (dashboardCleanHost?.isConnected) {
      dashboard.destroy?.();
      dashboardCleanHost.remove();
      dashboardCleanHost = null;
      dashboard.rootEl = el.gridWrap || null;
    }
    if (viewRootHost?.isConnected) {
      viewRootHost.innerHTML = "";
      viewRootHost.remove();
      viewRootHost = null;
    }
    activeViewerPane = null;
  }

  function applyUiOnlyLocalState() {
    if (!state.baseUrl) {
      state.baseUrl = "http://127.0.0.1:2030";
    }
    state.client = {
      ...(state.client || {}),
      label: "LOCAL CLIENT",
      max_windows: 4
    };
    state.clientRev = 1;
    state.modules = [];
    state.maxWindows = 4;
    if (!Number.isFinite(Number(state.currentWindows))) {
      state.currentWindows = 1;
    }
    el.viewerClientLabel.textContent = state.client.label;
    connectionPanel?.setValue?.(state.baseUrl);
    applyWindowStats({ current_windows: state.currentWindows, max_windows: state.maxWindows });
  }

  const connectionPanel = new ConnectionPanel(uiComponents.connectionPanel, {
    setMessage, setGlobalStatus,
    onConnect: async (baseUrlRaw) => {
      const url = String(baseUrlRaw || "").replace(/\/+$/, "");
      state.baseUrl = url;
      connectionPanel.setValue(state.baseUrl);
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        setMessage(null, `No se puede conectar con el SDK: ${err.message || err}`, "error");
        return { ok: false };
      }
      // Provision the electron key if not yet stored
      const cfg = await window.kvClient?.getConfig?.() || {};
      if (!cfg.api_key) {
        const provResult = await window.kvClient?.provision?.({ base_url: url });
        if (!provResult?.ok) {
          setMessage(null, "No se pudo obtener la clave de acceso del SDK.", "error");
          return { ok: false };
        }
      }
      loginPanel.refreshMode();
      setScreen("login");
      return { ok: true, base_url: state.baseUrl };
    }
  });
  connectionPanel.mount();

  const loginPanel = new LoginPanel(uiComponents.loginPanel, {
    getBaseUrl: () => state.baseUrl,
    onLoginSuccess: async () => {
      await enterDashboard("Conectado");
    }
  });
  loginPanel.mount();

  function formatApiError(resp, fallback) {
    if (!resp) return fallback;
    const err = resp.error || fallback || "error";
    return resp.detail ? `${err}: ${resp.detail}` : err;
  }

  function isUiOnlyLoginResponse(resp) {
    return Boolean(resp && resp.ok && resp.session_token === "dev-session");
  }

  function applyWindowStats(resp) {
    if (!resp || typeof resp !== "object") return;
    if (Number.isFinite(Number(resp.current_windows))) {
      state.currentWindows = Number(resp.current_windows);
    }
    if (Number.isFinite(Number(resp.max_windows))) {
      state.maxWindows = Number(resp.max_windows);
    }
    const max = Number.isFinite(state.maxWindows) ? state.maxWindows : null;
    const cur = Number.isFinite(state.currentWindows) ? state.currentWindows : null;
    el.btnDuplicate.disabled = !max || !cur || cur >= max;
  }

  function renderViewerMeta(extraText) {
    const parts = [];
    if (state.baseUrl) parts.push(`API ${state.baseUrl}`);
    if (Number.isFinite(Number(state.clientRev))) parts.push(`Rev ${Number(state.clientRev)}`);
    if (state.selectedGroup) parts.push(`Grupo ${state.selectedGroup}`);
    if (state.client && Number.isFinite(Number(state.client.max_windows))) {
      parts.push(`Ventanas ${state.currentWindows || 1}/${Number(state.client.max_windows)}`);
    }
    if (extraText) parts.push(extraText);
    el.viewerMeta.textContent = parts.join(" | ") || "Sin datos";
  }

  function setViewerControlsMode(mode) {
    const isView = mode === "view";
    state.activeModuleId = isView ? "view" : null;
    if (el.viewerTop) {
      el.viewerTop.style.display = isView ? "grid" : "none";
    }
    if (el.viewerBody) {
      el.viewerBody.style.display = "grid";
      el.viewerBody.style.gridTemplateRows = "1fr";
      el.viewerBody.style.gap = "12px";
    }
    if (el.contractSummary) {
      el.contractSummary.style.display = "none";
      el.contractSummary.innerHTML = "";
    }
    const groupsDisplay = isView ? "flex" : "none";
    el.groupsStrip.style.display = groupsDisplay;
    el.btnRefreshGroups.style.display = isView ? "" : "none";
    el.btnRefreshState.style.display = isView ? "" : "none";
    el.btnDuplicate.style.display = isView ? "" : "none";
    if (!isView) {
      el.btnDuplicate.disabled = true;
      state.groups = [];
      state.selectedGroup = null;
      state.lastContract = null;
      el.groupsStrip.innerHTML = "";
      el.gridWrap.innerHTML = "";
    } else {
      applyWindowStats({ current_windows: state.currentWindows, max_windows: state.maxWindows });
    }
    syncModulesNavbar();
    setGlobalStatus("");
  }

  async function refreshClientState(options = {}) {
    applyUiOnlyLocalState();
    if (!options.noRender && state.activeModuleId !== "view") {
      state.modules = dashboard.update(state.modules);
      syncModulesNavbar(state.modules);
    }
    return {
      ok: true,
      resp: {
        ok: true,
        status: 200,
        client: { label: "LOCAL CLIENT", rev: 1 },
        modules: [],
        current_windows: state.currentWindows,
        max_windows: 4
      },
      revChanged: false,
      reason: "frontend_only_local"
    };
  }

  async function enterDashboard(note, options = {}) {
    const allowClientStateFailure = Boolean(options && options.allowClientStateFailure);
    const forceUiOnlyLocal = Boolean(options && options.forceUiOnlyLocal);
    const skipPolling = Boolean(options && options.noPolling);
    const isViewerToDashboard = state.activeScreenName === "viewer" && activeViewerPane === "view";
    viewModule?.stopPolling?.();
    if (IS_FRONTEND_ONLY_NAV || forceUiOnlyLocal) {
      applyUiOnlyLocalState();
      if (!isViewerToDashboard) {
        clearNavigationRoots();
      }
      setScreen("viewer");
      setViewerControlsMode("dashboard");
      viewModule?.clearViewerContract?.(null);
      el.viewerClientLabel.textContent = state.client?.label || "LOCAL CLIENT";
      ensureCleanDashboardHost();
      state.modules = dashboard.update(dashboard.normalizeModules(state.modules));
      syncModulesNavbar(state.modules);
      renderViewerMeta("");
      setBreadcrumb(["Dashboard"]);
      transitionViewerPane("dashboard");
      if (!skipPolling && !IS_FRONTEND_ONLY_NAV) {
        viewModule?.startPolling?.();
      }
      _startAlarmBadgePoller();
      return { ok: true, reason: "frontend_only_direct_dashboard" };
    }
    if (!isViewerToDashboard) {
      clearNavigationRoots();
    }
    setScreen("viewer");
    setViewerControlsMode("dashboard");
    viewModule?.clearViewerContract?.(null);
    el.viewerClientLabel.textContent = state.client?.label || "Cliente";
    renderViewerMeta("");
    const result = await refreshClientState({ noRender: true, silent: allowClientStateFailure });
    if (!result.ok) {
      if (allowClientStateFailure) {
        if (!state.client || typeof state.client !== "object") {
          state.client = { label: "DEV CLIENT", max_windows: 4 };
        } else if (!state.client.label) {
          state.client.label = "DEV CLIENT";
        }
        if (!Number.isFinite(Number(state.clientRev))) {
          state.clientRev = 1;
        }
        if (!Array.isArray(state.modules) || state.modules.length === 0) {
          state.modules = dashboard.normalizeModules([{ id: "view", title: "View", enabled: true }]);
        }
        ensureCleanDashboardHost();
        state.modules = dashboard.update(state.modules);
        syncModulesNavbar(state.modules);
        renderViewerMeta("");
        setBreadcrumb(["Dashboard"]);
        transitionViewerPane("dashboard");
        _startAlarmBadgePoller();
        return { ok: true, reason: "ui_only_fallback" };
      }
      return result;
    }
    ensureCleanDashboardHost();
    state.modules = dashboard.update(state.modules);
    syncModulesNavbar(state.modules);
    setBreadcrumb(["Dashboard"]);
    transitionViewerPane("dashboard");
    viewModule?.startPolling?.();
    _startAlarmBadgePoller();
    return result;
  }

  function enterModule(moduleRef = {}) {
    const moduleId = String(moduleRef?.id || "view").trim().toLowerCase() || "view";
    const moduleTitle = String(moduleRef?.title || (moduleId ? moduleId.charAt(0).toUpperCase() + moduleId.slice(1) : "View")).trim() || "View";
    const isDashboardToView = state.activeScreenName === "viewer" && activeViewerPane === "dashboard";
    if (!isDashboardToView) {
      clearNavigationRoots();
    }
    setScreen("viewer");
    setViewerControlsMode("dashboard");
    viewModule?.clearViewerContract?.(null);
    renderViewerMeta("");
    setBreadcrumb(["Dashboard", moduleTitle]);

    const viewHost = ensureViewRootHost();
    if (!viewHost) {
      return;
    }

    viewHost.dataset.moduleId = moduleId;
    viewHost.dataset.moduleTitle = moduleTitle;
    viewHost.innerHTML = "";
    transitionViewerPane("view");

    if (moduleId === "view") {
      _mountViewGroup(viewHost);
    } else if (moduleId === "commands") {
      _mountCommands(viewHost);
    } else if (moduleId === "audit") {
      _mountAudit(viewHost);
    } else if (moduleId === "camera") {
      _mountCameraManager(viewHost);
    } else if (moduleId === "storage" || moduleId === "almacenamiento") {
      _mountStorage(viewHost);
    } else if (moduleId === "record-schedule") {
      _mountRecordSchedule(viewHost);
    } else if (moduleId === "semantic") {
      _mountSemantic(viewHost);
    } else if (moduleId === "locale" || moduleId === "idioma") {
      _mountLocale(viewHost);
    } else if (moduleId === "playback" || moduleId === "reproducción") {
      _mountPlayback(viewHost);
    }
  }

  function enterView() {
    enterModule({ id: "view", title: "View" });
  }

  function enterConnection() {
    clearNavigationRoots();
    if (el.contractSummary) {
      el.contractSummary.style.display = "none";
    }
    if (el.viewerBody) {
      el.viewerBody.style.gridTemplateRows = "1fr";
      el.viewerBody.style.gap = "12px";
      el.viewerBody.style.display = "grid";
    }
    state.modules = [];
    state.activeModuleId = null;
    state.groups = [];
    state.selectedGroup = null;
    syncModulesNavbar([]);
    setScreen("url");
    setGlobalStatus("Configure conexion y continue.");
    connectionPanel.setValue(String(state.baseUrl || ""));
    connectionPanel.focus();
  }

  async function handleSessionExpired(reason) {
    viewModule?.stopPolling?.();
    state.modules = [];
    state.clientRev = null;
    state.activeModuleId = null;
    state.groups = [];
    state.selectedGroup = null;
    state.client = null;
    state.maxWindows = null;
    syncModulesNavbar([]);
    viewModule?.clearViewerContract?.("Sesion expirada.");
    viewModule?.renderGroups?.(state.groups);
    applyWindowStats({ current_windows: state.currentWindows, max_windows: null });
    setMessage(null, `Sesion finalizada (${reason}). Configure la URL para continuar.`, "error");
    enterConnection();
  }

  // Se dispara cuando se confirma que la sesion de Google (idToken +
  // refreshToken) ya no es valida — ver deps.onAuthExpired en ViewGroup
  // (renderer/components/view-group/view-group.js) y _updateAlarmBadge mas
  // abajo. Antes esto no se detectaba nunca en caliente: el grid de camaras
  // quedaba reintentando "Reconectando" para siempre, sin aviso, y sin
  // cerrar la sesion. _authExpiredHandled evita disparar el flujo mas de una
  // vez si varios canales/pollers lo detectan casi al mismo tiempo.
  let _authExpiredHandled = false;

  async function handleAuthExpired() {
    if (_authExpiredHandled) return;
    _authExpiredHandled = true;

    viewModule?.stopPolling?.();
    if (_alarmBadgeInterval) {
      clearInterval(_alarmBadgeInterval);
      _alarmBadgeInterval = null;
    }
    _activeViewGroup?.destroy?.();
    _activeViewGroup = null;
    _activeCommands?.destroy?.();
    _activeCommands = null;
    _activeAudit?.destroy?.();
    _activeAudit = null;
    _activeCameraManager?.destroy?.();
    _activeCameraManager = null;
    _activeStorage?.destroy?.();
    _activeStorage = null;
    _activeRecordSchedule?.destroy?.();
    _activeRecordSchedule = null;
    _activeSemantic?.destroy?.();
    _activeSemantic = null;
    _activePlayback?.destroy?.();
    _activePlayback = null;
    _activeLocale?.destroy?.();
    _activeLocale = null;

    state.modules = [];
    state.clientRev = null;
    state.activeModuleId = null;
    state.groups = [];
    state.selectedGroup = null;
    state.client = null;
    state.maxWindows = null;
    state.lastContract = null;
    syncModulesNavbar([]);

    // Cierra la sesion de verdad (limpia idToken/refreshToken en memoria y
    // el archivo persistido) para que no quede un estado a medias.
    await window.kvClient?.logout?.();

    clearNavigationRoots();
    loginPanel.refreshMode();
    setScreen("login");
    setMessage(null, "Tu sesion de Google expiro por inactividad. Inicia sesion nuevamente para continuar.", "error");
    _authExpiredHandled = false;
  }

  async function goToViewerAfterLogin(loginResp) {
    const isUiOnlyLogin = isUiOnlyLoginResponse(loginResp);
    state.client = loginResp.client || null;
    applyWindowStats(loginResp);
    el.viewerClientLabel.textContent = state.client?.label || "Cliente View";
    state.modules = [];
    state.clientRev = null;
    state.activeModuleId = null;
    syncModulesNavbar([]);
    setMessage(null, "", null);
    console.log("[KV] LOGIN SUCCESS -> entering dashboard");
    const refreshResult = await refreshClientState({ noRender: true, silent: isUiOnlyLogin });
    const clientModules = Array.isArray(state.modules) ? [...state.modules] : null;
    console.log("[KV] modules after refresh:", clientModules);
    if (!refreshResult?.ok) {
      if (!isUiOnlyLogin) {
        return;
      }
      console.warn("[KV][ui-only] refreshClientState failed after login, continuing to dashboard");
    }
    console.debug("[KV][dashboard] goToViewerAfterLogin -> enterDashboard");
    const dashboardResult = await enterDashboard(
      isUiOnlyLogin ? "Sesion iniciada (UI-only)" : "Sesion iniciada",
      { allowClientStateFailure: isUiOnlyLogin }
    );
    if (Array.isArray(clientModules)) {
      state.modules = dashboard.update(clientModules);
    }
    return dashboardResult;
  }

  // Mount a live ViewGroup inside the view host.
  // Cameras come from the SDK contract for the active group (if a session exists),
  // otherwise a stub card is shown.  The group name "principal" is used as a
  // best-effort fallback; real deployments should pass the selected group.
  let _activeViewGroup   = null;
  let _activeCommands    = null;
  let _activeAudit       = null;
  let _activeCameraManager = null;
  let _activeStorage     = null;
  let _activeRecordSchedule = null;
  let _activeSemantic     = null;

  async function _mountViewGroup(hostEl) {
    const { ViewGroup } = await import("../components/view-group/view-group.js");

    _activeViewGroup?.destroy?.();
    _activeViewGroup = null;

    if (!IS_DETACH_MODE) {
      state.activeModuleId = "view";
    }

    // Si hay una ventana desacoplada abierta, mostrar placeholder (solo ventana principal)
    if (!IS_DETACH_MODE) {
      const detachCheck = await window.kvClient?.detachStatus?.();
      if (detachCheck?.isOpen) {
        _setDetachToolbarLabel(true);
        hostEl.innerHTML = `
          <div class="detach-placeholder">
            <div class="detach-placeholder-icon">⊞</div>
            <p>Vista desacoplada</p>
            <small>Haz clic en <strong>Acoplar</strong> para restaurar aquí.</small>
          </div>
        `;
        return;
      }
    }

    // Always fetch a fresh contract so camera names and tokens are current.
    // Primero intenta con la sesion por codigo (x-view-session, ver
    // kv:view:state) — funciona offline y es la unica via disponible para un
    // login manual sin Firebase (ver colaboracion/055). Si no hay sesion por
    // codigo o el grupo no esta asignado a ese cliente, cae al Firebase
    // Bearer de siempre.
    const _refreshGroup = state.selectedGroup || "principal";
    try {
      const viewStateResp = await window.kvClient?.getState?.({ group: _refreshGroup });
      if (viewStateResp?.ok && viewStateResp.contract) {
        state.lastContract = viewStateResp.contract;
      } else {
        const r = await window.kvClient?.apiRequest?.({
          method: "POST", path: "/play/live/ui", body: { group: _refreshGroup }
        });
        if (r?.ok && r.data) state.lastContract = r.data;
      }
    } catch (_) {}

    const lastContract  = state.lastContract;
    const channels      = Array.isArray(lastContract?.channels) ? lastContract.channels : [];
    const streams       = Array.isArray(lastContract?.streams)  ? lastContract.streams  : [];
    const streamsByChannel = new Map(streams.map((s) => [Number(s.channel), s]));

    let cameras;
    if (channels.length > 0) {
      cameras = channels.map((ch) => ({
        id:     Number(ch.channel),
        name:   ch.name || `CH ${ch.channel}`,
        status: streamsByChannel.has(Number(ch.channel)) ? "online" : "offline"
      }));
    } else {
      // Demo mode: cámara en canal 1
      cameras = [{ id: 1, name: "Cámara Demo (Canal 1)", status: "online" }];
    }

    const layout  = lastContract?.layout?.value || "1x1";
    const group   = state.selectedGroup || "principal";
    const baseUrl = state.baseUrl || "http://127.0.0.1:2030";

    // Build a local token index from the contract so the ViewGroup can start
    // streams without a second IPC round-trip.  Falls back to kv:stream:token
    // for channels not yet in the contract.
    const contractTokens = new Map(streams.map((s) => [Number(s.channel), s]));

    const vg = new ViewGroup(
      hostEl,
      { name: group.charAt(0).toUpperCase() + group.slice(1), layout, cameras },
      {
        baseUrl,
        getStreamToken: async (channel) => {
          // Always use IPC — it handles both view-session path and no-session
          // API-key path, and returns api_key needed for stream fetch headers.
          const resp = await window.kvClient?.streamToken?.({ channel: Number(channel), group });
          return resp || { ok: false, error: "stream_token_unavailable" };
        },
        onDetach: async () => {
          return await _toggleDetach(group);
        },
        isDetached: IS_DETACH_MODE,
        onAuthExpired: handleAuthExpired,
      }
    );

    vg.mount();
    _activeViewGroup = vg;
  }

  async function _mountCommands(hostEl) {
    const { Commands } = await import("../components/commands/commands.js");
    _activeCommands?.destroy?.();
    _activeCommands = null;

    const cmd = new Commands(hostEl, {
      api: window.kvClient?.apiRequest?.bind(window.kvClient),
      onLogout: () => {
        loginPanel.refreshMode();
        setScreen("login");
      }
    });
    cmd.mount();
    _activeCommands = cmd;
  }

  async function _mountAudit(hostEl) {
    const { AuditExplorer } = await import("../components/commands/audit-explorer.js");
    _activeAudit?.destroy?.();
    _activeAudit = null;

    const explorer = new AuditExplorer(hostEl, window.kvClient?.apiRequest?.bind(window.kvClient));
    explorer.mount();
    _activeAudit = explorer;
  }

  async function _mountCameraManager(hostEl) {
    const { CameraManager } = await import("../components/camera-manager/camera-manager.js");
    _activeCameraManager?.destroy?.();
    _activeCameraManager = null;

    const mgr = new CameraManager(hostEl, window.kvClient?.apiRequest?.bind(window.kvClient));
    mgr.mount();
    _activeCameraManager = mgr;
  }

  async function _mountStorage(hostEl) {
    const { StoragePanel } = await import("../components/storage/storage.js");
    _activeStorage?.destroy?.();
    _activeStorage = null;

    const panel = new StoragePanel(hostEl, window.kvClient?.apiRequest?.bind(window.kvClient));
    panel.mount();
    _activeStorage = panel;
  }

  async function _mountRecordSchedule(hostEl) {
    const { RecordSchedulePanel } = await import("../components/record-schedule/record-schedule.js");
    _activeRecordSchedule?.destroy?.();
    _activeRecordSchedule = null;

    const panel = new RecordSchedulePanel(
      hostEl,
      window.kvClient?.apiRequest?.bind(window.kvClient),
      (msg, opts) => toastStack.push(msg, opts)
    );
    panel.mount();
    _activeRecordSchedule = panel;
  }

  async function _mountSemantic(hostEl) {
    const { SemanticPanel } = await import("../components/semantic/semantic.js");
    _activeSemantic?.destroy?.();
    _activeSemantic = null;

    const panel = new SemanticPanel(
      hostEl,
      window.kvClient?.apiRequest?.bind(window.kvClient),
      (msg, opts) => toastStack.push(msg, opts)
    );
    panel.mount();
    _activeSemantic = panel;
  }

  let _activePlayback = null;
  async function _mountPlayback(hostEl) {
    const { PlaybackModule } = await import("../components/playback/playback.js");
    _activePlayback?.destroy?.();
    _activePlayback = null;
    const panel = new PlaybackModule(hostEl, window.kvClient?.apiRequest?.bind(window.kvClient));
    panel.mount();
    _activePlayback = panel;
  }

  let _activeLocale = null;
  async function _mountLocale(hostEl) {
    const { LocalePanel } = await import("../components/locale/locale.js");
    _activeLocale?.destroy?.();
    _activeLocale = null;

    const panel = new LocalePanel(hostEl, window.kvClient?.apiRequest?.bind(window.kvClient));
    panel.mount();
    _activeLocale = panel;
  }

  // ── Alarm badge poller ─────────────────────────────────────────
  let _alarmBadgeInterval = null;

  async function _updateAlarmBadge() {
    try {
      const r = await window.kvClient?.apiRequest?.({ method: "GET", path: "/service/alarms" });
      if (r?.ok && r?.data) {
        const total = Number(r.data.total ?? (r.data.alarms?.length ?? 0));
        dashboard.setModuleBadge("alarms", total);
        return;
      }
      // Poller de fondo cada 30s — corre aunque el usuario no toque nada, asi
      // que es un buen punto para detectar sesion vencida sin depender de
      // que haya camaras en vivo abiertas (ver handleAuthExpired). Sin
      // idToken el main process devuelve error="not_logged_in" directo; con
      // idToken vencido y refresh fallido, kv:api:request devuelve el 401
      // que sobrevivio al intento de refresh (ver _requestWithTokenRefresh
      // en main/ipc/kv-ipc.js).
      //
      // kv:api:request es Firebase-only (nunca usa x-view-session, ver
      // colaboracion/055) — un login manual por codigo NO tiene idToken a
      // proposito (es un cliente restringido, sin acceso a Comandos/
      // Alarmas/etc.), asi que este "not_logged_in" es esperado para ese
      // caso y no significa que la sesion por codigo haya muerto. Antes de
      // forzar logout, confirma que tampoco haya una sesion por codigo activa.
      if (r && !r.ok && (r.error === "not_logged_in" || r.status === 401)) {
        const viewSession = await window.kvClient?.getSessionInfo?.();
        if (!viewSession?.logged_in) {
          await handleAuthExpired();
        }
      }
    } catch (_) {}
  }

  function _startAlarmBadgePoller() {
    if (_alarmBadgeInterval) return;
    void _updateAlarmBadge();
    _alarmBadgeInterval = setInterval(_updateAlarmBadge, 30000);
  }

  function _hideBootOverlay() {
    // setScreen() siempre dispara una animación de deslizamiento (520ms +
    // margen) entre la pantalla por defecto ("url") y la real — si el
    // overlay se destapa apenas termina boot(), esa animación de la
    // pantalla vieja alcanza a verse por debajo. Se espera a que termine
    // del todo antes de destapar.
    window.setTimeout(() => el.bootOverlay?.classList.remove("active"), 650);
  }

  async function boot() {
    setGlobalStatus("Iniciando…");

    try {
      // Main process handles port probing + provisioning (CSP blocks renderer fetch to non-whitelisted ports).
      const result = await window.kvClient?.autodiscover?.();

      if (result?.ok && result?.found) {
        state.baseUrl = result.base_url;
        connectionPanel?.setValue?.(state.baseUrl);

        // Si hay una sesión de Google persistida y no pasó el timeout de
        // inactividad (30 min desde el último cierre), evita pedir login de nuevo.
        const restore = await window.kvClient?.tryRestoreSession?.();
        if (restore?.restored) {
          await enterDashboard("Conectado");
          return;
        }

        loginPanel.refreshMode();
        setScreen("login");
        return;
      }

      // SDK not found locally — ask user for URL
      enterConnection();
    } finally {
      // Espera también a las traducciones (corren en paralelo desde el
      // inicio de initApp) antes de destapar — si no, un módulo migrado
      // podría montarse antes de que lleguen y mostrar el fallback.
      await _translationsReady;
      // Se oculta siempre, sin importar a qué pantalla se haya ido —
      // evita que un reload (p. ej. tras cambiar idioma) muestre un
      // flash de la pantalla de conexión mientras boot() resuelve.
      _hideBootOverlay();
    }
  }

  // ── Detach helpers ───────────────────────────────────────────────
  function _setDetachToolbarLabel(isOpen) {
    if (el.btnDuplicate) el.btnDuplicate.textContent = isOpen ? "Acoplar" : "Desacoplar";
  }

  function _showDetachPlaceholder() {
    _activeViewGroup?.destroy?.();
    _activeViewGroup = null;
    if (viewRootHost) {
      viewRootHost.innerHTML = `
        <div class="detach-placeholder">
          <div class="detach-placeholder-icon">⊞</div>
          <p>Vista desacoplada</p>
          <small>Haz clic en <strong>Acoplar</strong> para restaurar aquí.</small>
        </div>
      `;
    }
  }

  async function _reattachView() {
    // Solo restaurar si el viewRootHost está en el DOM (usuario en View)
    if (!viewRootHost?.isConnected) return;
    viewRootHost.innerHTML = "";
    await _mountViewGroup(viewRootHost);
  }

  async function _toggleDetach(group) {
    const result = await window.kvClient?.detachWindow?.({ initialGroup: group });
    if (!result?.ok) return result;
    const isOpen = result.action === "opened";
    _setDetachToolbarLabel(isOpen);
    if (isOpen) {
      _showDetachPlaceholder();
    } else {
      await _reattachView();
    }
    return result;
  }

  if (el.btnDuplicate) {
    el.btnDuplicate.addEventListener("click", async () => {
      if (state.activeModuleId !== "view") return;
      await _toggleDetach(state.selectedGroup || "principal");
    });
  }

  // Cuando el usuario cierra la ventana desacoplada con X → restaurar vista principal
  window.kvClient?.onDetachClosed?.(() => {
    _setDetachToolbarLabel(false);
    void _reattachView();
  });

  if (el.btnLogout) {
    el.btnLogout.style.display = "none";
    el.btnLogout.addEventListener("click", async () => {
      viewModule?.stopPolling?.();
      state.modules = [];
      state.clientRev = null;
      state.activeModuleId = null;
      syncModulesNavbar([]);
      state.groups = [];
      state.selectedGroup = null;
      state.client = null;
      state.lastContract = null;
      state.maxWindows = null;
      applyWindowStats({ current_windows: state.currentWindows, max_windows: null });
      viewModule?.clearViewerContract?.("Sesion cerrada.");
      setMessage(null, "Sesion cerrada. Ingrese codigo para continuar.", null);
      enterConnection();
    });
  }

  if (IS_DETACH_MODE) {
    (async () => {
      try {
        try {
          const cfg = await window.kvClient?.getConfig?.() || {};
          if (cfg.base_url) state.baseUrl = cfg.base_url;
        } catch (_) {}
        state.baseUrl = state.baseUrl || "http://127.0.0.1:2030";
        if (DETACH_INITIAL_GROUP) state.selectedGroup = DETACH_INITIAL_GROUP;

        setScreen("viewer");
        const viewHost = ensureViewRootHost();
        if (viewHost) {
          viewHost.dataset.moduleId = "view";
          viewHost.innerHTML = "";
          transitionViewerPane("view");
          await _mountViewGroup(viewHost);
        }
      } finally {
        await _translationsReady;
        _hideBootOverlay();
      }
    })();
  } else {
    boot();
  }
}
