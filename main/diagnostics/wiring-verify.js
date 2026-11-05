function verifyMainWiring() {
  const checks = [];

  function pushCheck(name, ok, detail) {
    const entry = { name, ok: Boolean(ok) };
    if (detail) {
      entry.detail = String(detail);
    }
    checks.push(entry);
    return entry;
  }

  function safeRequire(name, modulePath) {
    try {
      const mod = require(modulePath);
      pushCheck(`require:${name}`, true);
      return mod;
    } catch (err) {
      pushCheck(
        `require:${name}`,
        false,
        String(err && err.stack ? err.stack : (err && err.message ? err.message : err))
      );
      return null;
    }
  }

  function checkFunction(moduleName, exportsObj, exportName) {
    const value = exportsObj ? exportsObj[exportName] : undefined;
    pushCheck(
      `export:${moduleName}.${exportName}`,
      typeof value === "function",
      typeof value === "function" ? "" : `expected function, got ${typeof value}`
    );
  }

  function checkDefined(moduleName, exportsObj, exportName) {
    const value = exportsObj ? exportsObj[exportName] : undefined;
    pushCheck(
      `export:${moduleName}.${exportName}`,
      value !== undefined,
      value !== undefined ? "" : "expected defined export"
    );
  }

  const modules = {
    bootstrap: safeRequire("bootstrap", "../bootstrap"),
    windowIpc: safeRequire("ipc/window-ipc", "../ipc/window-ipc"),
    kvIpc: safeRequire("ipc/kv-ipc", "../ipc/kv-ipc"),
    splashWindow: safeRequire("windows/splash-window", "../windows/splash-window"),
    viewerWindow: safeRequire("windows/viewer-window", "../windows/viewer-window"),
    apiClient: safeRequire("api/api-client", "../api/api-client"),
    clientConfig: safeRequire("config/client-config", "../config/client-config"),
    runtimeState: safeRequire("session/runtime-state", "../session/runtime-state"),
    windowShape: safeRequire("windows/window-shape", "../windows/window-shape"),
    windowState: safeRequire("windows/window-state", "../windows/window-state")
  };

  checkFunction("bootstrap", modules.bootstrap, "initMainProcess");

  checkFunction("ipc/window-ipc", modules.windowIpc, "registerWindowIpcHandlers");
  checkFunction("ipc/kv-ipc", modules.kvIpc, "registerKvIpcHandlers");

  checkFunction("windows/splash-window", modules.splashWindow, "createAppWindows");
  checkFunction("windows/viewer-window", modules.viewerWindow, "createViewerWindow");

  checkFunction("api/api-client", modules.apiClient, "callViewApi");
  checkFunction("api/api-client", modules.apiClient, "apiRequest");
  checkFunction("api/api-client", modules.apiClient, "buildUrl");

  checkFunction("config/client-config", modules.clientConfig, "readClientConfig");
  checkFunction("config/client-config", modules.clientConfig, "writeClientConfig");
  checkFunction("config/client-config", modules.clientConfig, "normalizeBaseUrl");

  checkDefined("session/runtime-state", modules.runtimeState, "runtimeState");
  checkFunction("session/runtime-state", modules.runtimeState, "clearRuntimeSession");
  checkFunction("session/runtime-state", modules.runtimeState, "setRuntimeSession");
  checkFunction("session/runtime-state", modules.runtimeState, "getSessionInfoPayload");

  checkFunction("windows/window-shape", modules.windowShape, "buildRoundedShapeRects");
  checkFunction("windows/window-shape", modules.windowShape, "applyRoundedWindowShape");
  checkFunction("windows/window-shape", modules.windowShape, "applyViewerWindowShapeForState");

  if (modules.windowState) {
    checkDefined("windows/window-state", modules.windowState, "viewerWindows");
    checkDefined("windows/window-state", modules.windowState, "windowLifecycleState");
    checkDefined("windows/window-state", modules.windowState, "clearStartupTransitionTimer");
    checkDefined("windows/window-state", modules.windowState, "clearSplashFailsafeTimer");
  } else {
    pushCheck("export:windows/window-state", false, "module not available");
  }

  const summary = checks.reduce((acc, item) => {
    if (item.ok) acc.passed += 1;
    else acc.failed += 1;
    return acc;
  }, { passed: 0, failed: 0 });

  return {
    ok: summary.failed === 0,
    checks,
    summary
  };
}

module.exports = {
  verifyMainWiring
};
