const { BrowserWindow } = require("electron");
const path = require("path");

const { applyRoundedWindowShape } = require("./window-shape");
const {
  windowLifecycleState,
  clearStartupTransitionTimer,
  clearSplashFailsafeTimer
} = require("./window-state");
const { createViewerWindow } = require("./viewer-window");

const SPLASH_ANIMATION_FAILSAFE_MS = 6000;
const SPLASH_POST_INTRO_HOLD_MS = 1000;

function tryShowMainWindow() {
  if (!windowLifecycleState.mainWindow) {
    return;
  }
  if (!windowLifecycleState.mainDidFinishLoad || !windowLifecycleState.mainReadyToShow) {
    return;
  }

  if (!windowLifecycleState.splashWindow || windowLifecycleState.splashWindow.isDestroyed()) {
    windowLifecycleState.mainWindow.show();
    return;
  }

  if (windowLifecycleState.startupTransitionTimer) {
    return;
  }
  if (!windowLifecycleState.splashIntroComplete) {
    return;
  }

  const elapsedSinceIntroComplete = windowLifecycleState.splashIntroCompleteAt
    ? Date.now() - windowLifecycleState.splashIntroCompleteAt
    : 0;
  const holdRemainingMs = Math.max(0, SPLASH_POST_INTRO_HOLD_MS - elapsedSinceIntroComplete);

  windowLifecycleState.startupTransitionTimer = setTimeout(() => {
    windowLifecycleState.startupTransitionTimer = null;
    if (!windowLifecycleState.mainWindow || windowLifecycleState.mainWindow.isDestroyed()) {
      return;
    }
    windowLifecycleState.mainWindow.show();
    if (windowLifecycleState.splashWindow && !windowLifecycleState.splashWindow.isDestroyed()) {
      windowLifecycleState.splashWindow.close();
    }
  }, holdRemainingMs);
}

function createSplashWindow() {
  clearSplashFailsafeTimer();
  windowLifecycleState.splashIntroComplete = false;
  windowLifecycleState.splashIntroCompleteAt = 0;
  windowLifecycleState.splashWindow = new BrowserWindow({
    width: 900,
    height: 620,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    movable: true,
    transparent: true,
    show: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "splash_preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  windowLifecycleState.splashWindow.once("ready-to-show", () => {
    if (!windowLifecycleState.splashWindow || windowLifecycleState.splashWindow.isDestroyed()) {
      return;
    }
    applyRoundedWindowShape(windowLifecycleState.splashWindow, 22);
    windowLifecycleState.splashWindow.show();
    clearSplashFailsafeTimer();
    windowLifecycleState.splashFailsafeTimer = setTimeout(() => {
      windowLifecycleState.splashFailsafeTimer = null;
      windowLifecycleState.splashIntroComplete = true;
      windowLifecycleState.splashIntroCompleteAt = Date.now();
      tryShowMainWindow();
    }, SPLASH_ANIMATION_FAILSAFE_MS);
    tryShowMainWindow();
  });

  windowLifecycleState.splashWindow.on("closed", () => {
    clearSplashFailsafeTimer();
    windowLifecycleState.splashWindow = null;
  });

  windowLifecycleState.splashWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "splash.html"));
}

function createAppWindows() {
  createSplashWindow();
  createViewerWindow({ useSplash: true });
}

function handleSplashIntroComplete(event) {
  if (!windowLifecycleState.splashWindow || windowLifecycleState.splashWindow.isDestroyed()) {
    return;
  }
  if (event.sender !== windowLifecycleState.splashWindow.webContents) {
    return;
  }
  windowLifecycleState.splashIntroComplete = true;
  windowLifecycleState.splashIntroCompleteAt = Date.now();
  clearSplashFailsafeTimer();
  tryShowMainWindow();
}

windowLifecycleState.tryShowMainWindow = tryShowMainWindow;

module.exports = {
  SPLASH_ANIMATION_FAILSAFE_MS,
  SPLASH_POST_INTRO_HOLD_MS,
  tryShowMainWindow,
  createSplashWindow,
  createAppWindows,
  handleSplashIntroComplete
};
