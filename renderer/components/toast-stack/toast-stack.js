export class ToastStack {
  constructor(rootEl) {
    this.rootEl = rootEl || null;
    this._timers = new WeakMap();
    this._mounted = false;
  }

  mount() {
    if (this._mounted) return;
    this._mounted = true;
  }

  destroy() {
    this.clear();
    this._mounted = false;
  }

  push(message, options = {}) {
    const value = String(message || "").trim();
    if (!value || !this.rootEl) {
      return null;
    }

    let type = "info";
    let durationMs = 2200;
    if (typeof options === "string") {
      type = options || "info";
      durationMs = Math.max(600, Number(arguments[2]) || 2200);
    } else {
      type = options?.type || "info";
      durationMs = Math.max(600, Number(options?.durationMs) || 2200);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type || "info"}`;
    toast.textContent = value;
    this.rootEl.appendChild(toast);

    const cleanupTimers = () => {
      const timers = this._timers.get(toast);
      if (!timers) return;
      if (timers.hideId) clearTimeout(timers.hideId);
      if (timers.removeId) clearTimeout(timers.removeId);
      this._timers.delete(toast);
    };

    const hide = () => {
      if (!toast.isConnected) {
        cleanupTimers();
        return;
      }
      toast.classList.add("hide");
      const removeId = setTimeout(() => {
        if (toast.isConnected) {
          toast.remove();
        }
        cleanupTimers();
      }, 220);
      const timers = this._timers.get(toast) || {};
      timers.removeId = removeId;
      this._timers.set(toast, timers);
    };

    const hideId = setTimeout(hide, durationMs);
    this._timers.set(toast, { hideId, removeId: null });
    return toast;
  }

  clear() {
    if (!this.rootEl) return;
    Array.from(this.rootEl.children).forEach((node) => {
      const timers = this._timers.get(node);
      if (timers) {
        if (timers.hideId) clearTimeout(timers.hideId);
        if (timers.removeId) clearTimeout(timers.removeId);
        this._timers.delete(node);
      }
      if (typeof node.remove === "function") {
        node.remove();
      }
    });
  }
}
