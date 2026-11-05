export class ConnectionPanel {
  constructor(rootEl, deps = {}) {
    this.rootEl = rootEl || null;
    this.deps = deps || {};
    this.inputEl = this.rootEl?.querySelector("#base-url-input") || null;
    this.buttonEl = this.rootEl?.querySelector("#btn-url-continue") || null;
    this.bound = false;
    this.onConnectClick = this.onConnectClick.bind(this);
  }

  mount() {
    if (!this.rootEl) return;
    this.render();
    this.bindEvents();
  }

  destroy() {
    if (this.buttonEl) {
      this.buttonEl.removeEventListener("click", this.onConnectClick);
    }
    this.bound = false;
  }

  bindEvents() {
    if (this.bound) return;
    if (this.buttonEl) {
      this.buttonEl.addEventListener("click", this.onConnectClick);
    }
    this.bound = true;
  }

  render() {
    // No-op por ahora: el markup se conserva en index.html
  }

  getValue() {
    return String(this.inputEl?.value || "");
  }

  setValue(value) {
    if (this.inputEl) {
      this.inputEl.value = String(value || "");
    }
  }

  focus() {
    this.inputEl?.focus?.();
  }

  async onConnectClick() {
    const baseUrlRaw = this.getValue();
    if (this.buttonEl) this.buttonEl.disabled = true;
    try {
      const resp = await this.deps.onConnect?.(baseUrlRaw);
      if (resp && typeof resp.base_url === "string") {
        this.setValue(resp.base_url);
      }
    } finally {
      if (this.buttonEl) this.buttonEl.disabled = false;
    }
  }
}
