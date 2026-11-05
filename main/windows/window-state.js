const viewerWindows = new Set();

const windowLifecycleState = {
  mainWindow: null,
  splashWindow: null,
  mainDidFinishLoad: false,
  mainReadyToShow: false,
  splashIntroComplete: false,
  splashIntroCompleteAt: 0,
  startupTransitionTimer: null,
  splashFailsafeTimer: null,
  tryShowMainWindow: null
};

function clearStartupTransitionTimer() {
  if (windowLifecycleState.startupTransitionTimer) {
    clearTimeout(windowLifecycleState.startupTransitionTimer);
    windowLifecycleState.startupTransitionTimer = null;
  }
}

function clearSplashFailsafeTimer() {
  if (windowLifecycleState.splashFailsafeTimer) {
    clearTimeout(windowLifecycleState.splashFailsafeTimer);
    windowLifecycleState.splashFailsafeTimer = null;
  }
}

module.exports = {
  viewerWindows,
  windowLifecycleState,
  clearStartupTransitionTimer,
  clearSplashFailsafeTimer
};
