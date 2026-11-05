export const state = {
  baseUrl: "",
  selectedGroup: null,
  groups: [],
  modules: [],
  client: null,
  clientRev: null,
  activeModuleId: null,
  lastContract: null,
  pollingId: null,
  pollingBusy: false,
  isLoadingState: false,
  currentWindows: null,
  maxWindows: null,
  activeScreenName: "url",
  screenAnim: null,
  windowMaximized: false,
  windowFullscreen: false
};

export function patchState(partial) {
  if (!partial || typeof partial !== "object") return state;
  Object.assign(state, partial);
  return state;
}

export function setActiveScreenName(name) {
  state.activeScreenName = name;
  return state.activeScreenName;
}

export function setScreenAnim(anim) {
  state.screenAnim = anim;
  return state.screenAnim;
}

export function setWindowFrameState({ maximized = false, fullscreen = false } = {}) {
  state.windowMaximized = Boolean(maximized);
  state.windowFullscreen = Boolean(fullscreen);
}

