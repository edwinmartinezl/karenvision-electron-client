export const el = {
  bootOverlay: document.getElementById("boot-overlay"),
  status: document.getElementById("global-status"),
  toastStack: document.getElementById("toast-stack"),
  screenUrl: document.getElementById("screen-url"),
  screenLogin: document.getElementById("screen-login"),
  screenViewer: document.getElementById("screen-viewer"),
  urlInput: document.getElementById("base-url-input"),
  groupsStrip: document.getElementById("groups-strip"),
  viewerClientLabel: document.getElementById("viewer-client-label"),
  viewerMeta: document.getElementById("viewer-meta"),
  contractSummary: document.getElementById("contract-summary"),
  gridWrap: document.getElementById("grid-wrap"),
  chromeBar: document.querySelector(".chrome-bar"),
  viewerTop: document.querySelector("#screen-viewer .viewer-top"),
  viewerBody: document.querySelector("#screen-viewer .viewer-body"),
  viewerActions: document.querySelector("#screen-viewer .viewer-actions"),
  btnUrlContinue: document.getElementById("btn-url-continue"),
  btnRefreshGroups: document.getElementById("btn-refresh-groups"),
  btnRefreshState: document.getElementById("btn-refresh-state"),
  btnDuplicate: document.getElementById("btn-duplicate"),
  btnLogout: document.getElementById("btn-logout"),
  btnMax: document.getElementById("btn-max")
};

export const uiComponents = Object.freeze({
  appShell: document.querySelector('[data-component="app-shell"]'),
  connectionPanel: document.querySelector('[data-component="connection-panel"]'),
  loginPanel: document.querySelector('[data-component="login-panel"]'),
  viewerShell: document.querySelector('[data-component="viewer-shell"]'),
  viewerHeader: document.querySelector('[data-component="viewer-header"]'),
  viewerGroupsStrip: document.querySelector('[data-component="viewer-groups-strip"]'),
  viewerBody: document.querySelector('[data-component="viewer-body"]'),
  dashboardGrid: document.querySelector('[data-component="viewer-dashboard-grid"]')
});

export function getScreenMap() {
  return {
    url: el.screenUrl,
    login: el.screenLogin,
    viewer: el.screenViewer
  };
}

