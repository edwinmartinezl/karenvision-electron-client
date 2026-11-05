export class Dashboard {
  constructor(rootEl, deps = {}) {
    this.rootEl = rootEl || null;
    this.deps = deps || {};
    this.modules = [];
    this.isMounted = false;
  }

  getModuleCards() {
    return [
      {
        id: "view",
        title: "Vista",
        icon: "👁",
        description: "Visualización de cámaras en vivo por grupo."
      },
      {
        id: "playback",
        title: "Reproducción",
        icon: "⏪",
        description: "Revisión de sesiones de video grabadas."
      },
      {
        id: "camera",
        title: "Cámaras",
        icon: "📷",
        description: "Configuración y gestión de canales de cámara."
      },
      {
        id: "storage",
        title: "Almacenamiento",
        icon: "💾",
        description: "Uso de disco y cuota por canal."
      },
      {
        id: "record-schedule",
        title: "Calendario de Grabaciones",
        icon: "🗓",
        description: "Programa cuándo debe grabar cada canal."
      },
      {
        id: "semantic",
        title: "Búsqueda Semántica",
        icon: "🔍",
        description: "Extrae frames de un rango grabado para análisis posterior."
      },
      {
        id: "audit",
        title: "Auditoría",
        icon: "📋",
        description: "Registros de actividad y trazabilidad de eventos."
      },
      {
        id: "export",
        title: "Exportación",
        icon: "📤",
        description: "Extracción de video y datos del sistema."
      },
      {
        id: "commands",
        title: "Comandos",
        icon: "⚙",
        description: "Operaciones y herramientas de control del sistema."
      },
      {
        id: "locale",
        title: "Idioma",
        icon: "🌐",
        description: "Idioma activo del sistema NVR (es / en)."
      },
    ];
  }

  mount() {
    if (!this.rootEl) {
      return;
    }
    this.isMounted = true;
    this.rootEl.classList.add("kv-dashboard-host");
  }

  destroy() {
    if (!this.rootEl) {
      return;
    }
    this.rootEl.classList.remove("kv-dashboard-host");
    this.isMounted = false;
  }

  normalizeModules(modules) {
    return (Array.isArray(modules) ? modules : []).map((item) => {
      const id = String(item?.id || "").trim().toLowerCase();
      const title = String(item?.title || (id === "view" ? "View" : id || "Modulo")).trim();
      return {
        ...(item && typeof item === "object" ? item : {}),
        id,
        title
      };
    }).filter((item) => item.id);
  }

  hasEnabledModule(moduleId, modulesInput = this.modules) {
    const target = String(moduleId || "").trim().toLowerCase();
    if (!target) return false;
    return (Array.isArray(modulesInput) ? modulesInput : []).some((item) => (
      String(item?.id || "").trim().toLowerCase() === target && item?.enabled !== false
    ));
  }

  update(modules) {
    this.modules = this.normalizeModules(modules);
    this.render();
    return this.modules;
  }

  render() {
    this.deps.setViewerControlsMode?.("dashboard");
    this.deps.prepareViewerBodyForDashboard?.();
    const host = this.rootEl;
    if (!host) {
      return;
    }
    this.mount();
    host.innerHTML = `
      <div class="dashboard-grid"></div>
    `;

    const gridEl = host.querySelector(".dashboard-grid");
    if (!gridEl) {
      return;
    }

    this._gridEl = gridEl;

    this.getModuleCards().forEach((moduleCard) => {
      const cardEl = document.createElement("div");
      cardEl.className = `module-card module-card-${String(moduleCard.id || "").trim().toLowerCase()}`;
      cardEl.setAttribute("role", "button");
      cardEl.setAttribute("tabindex", "0");
      cardEl.setAttribute("aria-label", `Abrir modulo ${moduleCard.title}`);
      cardEl.dataset.moduleId = moduleCard.id;
      cardEl.innerHTML = `
        <div class="module-card-toprow">
          <div class="module-icon">${moduleCard.icon}</div>
          <span class="module-alert-badge hidden"></span>
        </div>
        <div class="module-content">
          <h3 class="module-title">${moduleCard.title}</h3>
          <p class="module-description">
             ${moduleCard.description}
          </p>
        </div>
      `;

      const activateCard = () => {
        if (typeof this.deps.onOpenModule === "function") {
          this.deps.onOpenModule({ ...moduleCard });
          return;
        }
        if (String(moduleCard.id || "").trim().toLowerCase() === "view") {
          this.deps.onOpenViewModule?.();
          return;
        }
        console.log(`${moduleCard.id} clicked`);
      };

      cardEl.addEventListener("click", () => {
        activateCard();
      });
      cardEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activateCard();
      });

      gridEl.appendChild(cardEl);
    });
  }

  setModuleBadge(moduleId, count) {
    if (!this._gridEl) return;
    const card = this._gridEl.querySelector(`[data-module-id="${moduleId}"]`);
    if (!card) return;
    const badge = card.querySelector(".module-alert-badge");
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.classList.remove("hidden");
      badge.classList.toggle("badge-error", count >= 1);
    } else {
      badge.classList.add("hidden");
    }
  }
}
