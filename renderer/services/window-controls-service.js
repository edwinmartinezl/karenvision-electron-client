const api = window.windowControls || {};

export const windowControlsService = {
  minimize() {
    return api?.minimize?.();
  },
  maximize() {
    return api?.maximize?.();
  },
  close() {
    return api?.close?.();
  },
  getState() {
    return api?.getState?.();
  },
  onStateChange(handler) {
    return api?.onStateChange?.(handler) || (() => {});
  }
};

