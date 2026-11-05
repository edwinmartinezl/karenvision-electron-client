const { BrowserWindow, Menu } = require("electron");
const path = require("path");

const { applyViewerWindowShapeForState } = require("./window-shape");
const {
  viewerWindows,
  windowLifecycleState,
  clearStartupTransitionTimer,
  clearSplashFailsafeTimer
} = require("./window-state");

let _detachedWin = null;

function isDetachedWindowOpen() {
  return Boolean(_detachedWin && !_detachedWin.isDestroyed());
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) {
    return;
  }
  try {
    win.webContents.send("window:state", {
      maximized: typeof win.isMaximized === "function" ? win.isMaximized() : false,
      fullscreen: typeof win.isFullScreen === "function" ? win.isFullScreen() : false
    });
  } catch (_err) {
    // El renderer puede no estar listo; no es fatal.
  }
}

function syncViewerWindowChromeState(win) {
  applyViewerWindowShapeForState(win);
  sendWindowState(win);
}

function createViewerWindow({ useSplash = false, initialGroup = null } = {}) {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    useContentSize: true,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    transparent: true,
    resizable: true,
    fullscreenable: true,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  viewerWindows.add(win);
  win.on("resize", () => syncViewerWindowChromeState(win));
  win.on("maximize", () => sendWindowState(win));
  win.on("unmaximize", () => syncViewerWindowChromeState(win));
  win.on("enter-full-screen", () => syncViewerWindowChromeState(win));
  win.on("leave-full-screen", () => syncViewerWindowChromeState(win));

  if (useSplash) {
    windowLifecycleState.mainWindow = win;
    clearStartupTransitionTimer();
    clearSplashFailsafeTimer();
    windowLifecycleState.mainDidFinishLoad = false;
    windowLifecycleState.mainReadyToShow = false;

    win.webContents.on("did-finish-load", () => {
      windowLifecycleState.mainDidFinishLoad = true;
      windowLifecycleState.tryShowMainWindow?.();
    });

    win.once("ready-to-show", () => {
      syncViewerWindowChromeState(win);
      windowLifecycleState.mainReadyToShow = true;
      windowLifecycleState.tryShowMainWindow?.();
    });
  } else {
    win.once("ready-to-show", () => {
      syncViewerWindowChromeState(win);
      if (!win.isDestroyed()) {
        win.show();
        win.webContents.openDevTools({ mode: "detach" });
      }
    });
  }

  win.on("closed", () => {
    viewerWindows.delete(win);
    if (win === windowLifecycleState.mainWindow) {
      clearStartupTransitionTimer();
      clearSplashFailsafeTimer();
      windowLifecycleState.mainWindow = null;
    }
  });

  const rendererIndexPath = path.join(__dirname, "..", "..", "renderer", "index.html");
  const normalizedInitialGroup = String(initialGroup || "").trim().toLowerCase();
  const query = {};
  if (normalizedInitialGroup) {
    query.initialGroup = normalizedInitialGroup;
  }
  if (process.env.KV_DEV_UI_ONLY === "1") {
    query.dev_ui_only = "1";
  }
  if (Object.keys(query).length > 0) {
    win.loadFile(rendererIndexPath, { query });
  } else {
    win.loadFile(rendererIndexPath);
  }
  return win;
}

function createDetachedWindow({ initialGroup = null } = {}) {
  // Toggle: close if already open
  if (_detachedWin && !_detachedWin.isDestroyed()) {
    _detachedWin.close();
    _detachedWin = null;
    return { action: "closed" };
  }

  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 860,
    height: 560,
    minWidth: 360,
    minHeight: 280,
    frame: false,
    transparent: true,
    resizable: true,
    fullscreenable: true,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  viewerWindows.add(win);
  win.on("resize",         () => syncViewerWindowChromeState(win));
  win.on("maximize",       () => sendWindowState(win));
  win.on("unmaximize",     () => syncViewerWindowChromeState(win));
  win.on("enter-full-screen", () => syncViewerWindowChromeState(win));
  win.on("leave-full-screen", () => syncViewerWindowChromeState(win));

  _detachedWin = win;

  win.once("ready-to-show", () => {
    syncViewerWindowChromeState(win);
    if (!win.isDestroyed()) win.show();
  });

  win.on("closed", () => {
    viewerWindows.delete(win);
    _detachedWin = null;
    // Notify remaining viewer windows that detach closed
    for (const vw of viewerWindows) {
      if (!vw.isDestroyed()) {
        try { vw.webContents.send("kv:view:detach-closed", { isOpen: false }); } catch (_) {}
      }
    }
  });

  const rendererIndexPath = path.join(__dirname, "..", "..", "renderer", "index.html");
  const query = { mode: "detach" };
  const normalizedGroup = String(initialGroup || "").trim().toLowerCase();
  if (normalizedGroup) query.initialGroup = normalizedGroup;
  win.loadFile(rendererIndexPath, { query });
  return { action: "opened" };
}

module.exports = {
  sendWindowState,
  syncViewerWindowChromeState,
  createViewerWindow,
  createDetachedWindow,
  isDetachedWindowOpen
};
