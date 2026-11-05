const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("windowControls", {
  minimize() {
    return ipcRenderer.invoke("window:minimize");
  },
  maximize() {
    return ipcRenderer.invoke("window:maximize");
  },
  getState() {
    return ipcRenderer.invoke("window:get-state");
  },
  onStateChange(handler) {
    if (typeof handler !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => handler(payload || {});
    ipcRenderer.on("window:state", listener);
    return () => {
      ipcRenderer.removeListener("window:state", listener);
    };
  },
  close() {
    return ipcRenderer.invoke("window:close");
  }
});

contextBridge.exposeInMainWorld("kvClient", {
  getConfig() {
    return ipcRenderer.invoke("kv:config:get");
  },
  setConfig(payload) {
    return ipcRenderer.invoke("kv:config:set", payload);
  },
  autodiscover() {
    return ipcRenderer.invoke("kv:client:autodiscover");
  },
  provision(payload) {
    return ipcRenderer.invoke("kv:client:provision", payload);
  },
  pickFolder() {
    return ipcRenderer.invoke("kv:dialog:pick-folder");
  },
  pickSaveFile(defaultName) {
    return ipcRenderer.invoke("kv:dialog:pick-save-file", { defaultName });
  },
  getSessionInfo() {
    return ipcRenderer.invoke("kv:view:session-info");
  },
  login(payload) {
    return ipcRenderer.invoke("kv:view:login", payload);
  },
  checkInternet() {
    return ipcRenderer.invoke("kv:net:check-internet");
  },
  loginWithGoogle() {
    return ipcRenderer.invoke("kv:auth:google-login");
  },
  getGoogleSession() {
    return ipcRenderer.invoke("kv:auth:session-info");
  },
  tryRestoreSession() {
    return ipcRenderer.invoke("kv:auth:try-restore-session");
  },
  logout() {
    return ipcRenderer.invoke("kv:view:logout");
  },
  getGroups() {
    return ipcRenderer.invoke("kv:view:groups");
  },
  getClientState() {
    return ipcRenderer.invoke("kv:client:state");
  },
  getState(payload) {
    return ipcRenderer.invoke("kv:view:state", payload);
  },
  duplicateWindow(payload) {
    return ipcRenderer.invoke("kv:view:duplicate-window", payload);
  },
  detachWindow(payload) {
    return ipcRenderer.invoke("kv:view:detach-window", payload);
  },
  detachStatus() {
    return ipcRenderer.invoke("kv:view:detach-status");
  },
  onDetachClosed(handler) {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload || {});
    ipcRenderer.on("kv:view:detach-closed", listener);
    return () => ipcRenderer.removeListener("kv:view:detach-closed", listener);
  },
  streamToken(payload) {
    return ipcRenderer.invoke("kv:stream:token", payload);
  },
  apiRequest(payload) {
    return ipcRenderer.invoke("kv:api:request", payload);
  },
  i18nReadCache(locale) {
    return ipcRenderer.invoke("kv:i18n:read-cache", { locale });
  },
  i18nWriteCache(locale, translations) {
    return ipcRenderer.invoke("kv:i18n:write-cache", { locale, translations });
  },
  getPlaybackProxyInfo() {
    return ipcRenderer.invoke("kv:playback:proxy-info");
  }
});
