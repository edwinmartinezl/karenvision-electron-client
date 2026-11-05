function ensureModulesNavbarStylesheet() {
  const linkId = "kv-modules-navbar-stylesheet";
  if (document.getElementById(linkId)) {
    return;
  }

  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  link.href = new URL("./modules-navbar.css", import.meta.url).href;
  document.head.appendChild(link);
}

export class ModulesNavbar {
  constructor({ mountEl, deps } = {}) {
    this.mountEl = mountEl || null;
    this.deps = deps || {};
    this.hostEl = null;
    this.modules = [];
    this.activeModuleId = null;
    this.isMounted = false;
  }

  mount() {
    if (!this.mountEl) {
      return;
    }

    ensureModulesNavbarStylesheet();
    this.hostEl = this.ensureHost();
    this.isMounted = true;
    this.render();
  }

  destroy() {
    if (this.hostEl && this.hostEl.parentNode) {
      this.hostEl.parentNode.removeChild(this.hostEl);
    }
    this.hostEl = null;
    this.isMounted = false;
    this.modules = [];
    this.activeModuleId = null;
  }

  update(modules) {
    this.modules = Array.isArray(modules) ? modules : [];
    if (this.isMounted) {
      this.render();
    }
  }

  setActive(moduleId) {
    const normalized = String(moduleId || "").trim().toLowerCase();
    this.activeModuleId = normalized || null;
    if (this.isMounted) {
      this.applyActiveState();
    }
  }

  ensureHost() {
    if (this.hostEl && this.hostEl.isConnected) {
      return this.hostEl;
    }

    let host = document.getElementById("dashboard-modules-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "dashboard-modules-host";
      const statusEl = document.getElementById("global-status");
      if (statusEl && statusEl.parentNode === this.mountEl) {
        this.mountEl.insertBefore(host, statusEl);
      } else {
        this.mountEl.appendChild(host);
      }
    }

    host.classList.add("kv-modules-navbar");
    this.hostEl = host;
    return host;
  }

  isModuleEnabled(moduleId, moduleItem) {
    if (typeof this.deps.hasEnabledModule === "function") {
      try {
        return Boolean(this.deps.hasEnabledModule(moduleId));
      } catch (_err) {
        return false;
      }
    }
    return moduleItem?.enabled !== false;
  }

  applyActiveState() {
    if (!this.hostEl) {
      return;
    }

    const activeId = this.activeModuleId;
    this.hostEl.querySelectorAll(".kv-modules-navbar__button").forEach((buttonEl) => {
      const isActive = Boolean(activeId) && buttonEl.dataset.moduleId === activeId;
      buttonEl.classList.toggle("is-active", isActive);
      buttonEl.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  render() {
    const host = this.ensureHost();
    if (!host) {
      return;
    }

    host.innerHTML = "";

    const modules = Array.isArray(this.modules) ? this.modules : [];
    host.classList.toggle("is-empty", modules.length === 0);
    if (!modules.length) {
      return;
    }

    modules.forEach((moduleItem) => {
      const moduleId = String(moduleItem?.id || "").trim().toLowerCase();
      if (!moduleId) {
        return;
      }

      const buttonEl = document.createElement("button");
      const moduleTitle = String(moduleItem?.title || moduleItem?.id || "Modulo");
      const isEnabled = this.isModuleEnabled(moduleId, moduleItem);

      buttonEl.type = "button";
      buttonEl.className = "kv-modules-navbar__button";
      buttonEl.dataset.moduleId = moduleId;
      buttonEl.textContent = moduleTitle;
      buttonEl.setAttribute("aria-disabled", isEnabled ? "false" : "true");
      buttonEl.disabled = !isEnabled;
      buttonEl.classList.toggle("is-disabled", !isEnabled);

      buttonEl.addEventListener("click", async () => {
        if (!isEnabled) {
          return;
        }
        await this.deps.onModuleClick?.(moduleId);
      });

      host.appendChild(buttonEl);
    });

    this.applyActiveState();
  }
}
