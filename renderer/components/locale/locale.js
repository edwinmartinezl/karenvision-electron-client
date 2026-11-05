import { t, loadTranslations } from "../../core/i18n.js";

const LOCALES = [
  { code: "es", label: "Español",  flag: "🇩🇴" },
  { code: "en", label: "English",  flag: "🇺🇸" },
];

const RELOAD_DELAY_MS = 450;

export class LocalePanel {
  constructor(hostEl, api) {
    this.hostEl = hostEl || null;
    this.api    = api   || null;
    this._root  = null;
    this._current = null;
  }

  mount() {
    if (!this.hostEl) return;
    this._root = document.createElement("div");
    this._root.className = "locale-panel";
    this._root.innerHTML = `
      <div class="locale-header">
        <div class="locale-title">
          <span class="locale-icon">🌐</span>
          ${t("UI.LOCALE.TITLE", "Idioma del sistema")}
        </div>
        <p class="locale-subtitle">${t("UI.LOCALE.SUBTITLE", "Selecciona el idioma activo del NVR. El cambio se aplica de inmediato.")}</p>
      </div>
      <div class="locale-cards" id="locale-cards"></div>
      <div class="locale-status" id="locale-status"></div>
    `;
    this.hostEl.appendChild(this._root);
    this._load();
  }

  destroy() {
    this._root?.remove();
    this._root = null;
  }

  async _load() {
    this._setStatus(t("UI.LOCALE.LOADING", "Consultando idioma actual…"), "info");
    try {
      const resp = await this.api({ method: "GET", path: "/system/locale/status" });
      if (!resp?.ok) {
        if (resp?.error === "not_logged_in") {
          this._setStatus(t("UI.LOCALE.NOT_LOGGED_IN", "Sesión no iniciada — iniciá sesión para consultar o cambiar el idioma."), "error");
        } else {
          this._setStatus(t("UI.LOCALE.STATUS_ERROR", "Error al consultar idioma: {detail}", {
            detail: resp?.data?.detail || "sin respuesta"
          }), "error");
        }
        // Aunque no se pudo confirmar el idioma activo, se muestran las
        // tarjetas igual (con "es" como mejor estimación) para que el
        // usuario no quede sin ninguna forma de interactuar con el panel.
        this._current = this._current || "es";
        this._renderCards();
        return;
      }
      this._current = resp.data?.payload?.locale || resp.data?.locale || "es";
      // Asegura que las traducciones del propio panel estén al día con
      // el idioma confirmado por el backend, aunque el bootstrap de
      // arranque haya corrido antes de tener sesión.
      await loadTranslations(this._current);
      this._renderCards();
      this._setStatus(t("UI.LOCALE.ACTIVE", "Idioma activo: {label}", {
        label: this._labelFor(this._current)
      }), "ok");
    } catch (err) {
      this._setStatus(t("UI.LOCALE.GENERIC_ERROR", "Error: {detail}", {
        detail: err.message || err
      }), "error");
    }
  }

  _labelFor(code) {
    return LOCALES.find(l => l.code === code)?.label || code.toUpperCase();
  }

  _renderCards() {
    const container = this._root?.querySelector("#locale-cards");
    if (!container) return;
    container.innerHTML = "";
    for (const loc of LOCALES) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "locale-card" + (loc.code === this._current ? " active" : "");
      card.innerHTML = `
        <span class="locale-flag">${loc.flag}</span>
        <span class="locale-card-label">${loc.label}</span>
        <span class="locale-card-code">${loc.code}</span>
        <svg class="locale-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      `;
      card.addEventListener("click", () => this._set(loc.code));
      container.appendChild(card);
    }
  }

  async _set(code) {
    if (code === this._current) {
      this._setStatus(t("UI.LOCALE.ALREADY_ACTIVE", "Ya está activo: {label}", {
        label: this._labelFor(code)
      }), "ok");
      return;
    }
    this._setStatus(t("UI.LOCALE.APPLYING", "Aplicando cambio…"), "info");
    const cards = this._root?.querySelectorAll(".locale-card");
    cards?.forEach(c => c.disabled = true);
    try {
      const resp = await this.api({ method: "POST", path: "/system/locale/set", body: { locale: code } });
      if (!resp?.ok) {
        if (resp?.error === "not_logged_in") {
          this._setStatus(t("UI.LOCALE.NOT_LOGGED_IN", "Sesión no iniciada — iniciá sesión para consultar o cambiar el idioma."), "error");
        } else {
          this._setStatus(t("UI.LOCALE.SET_ERROR", "Error al cambiar idioma: {detail}", {
            detail: resp?.data?.detail || "sin respuesta"
          }), "error");
        }
        cards?.forEach(c => c.disabled = false);
        return;
      }

      this._current = code;
      const loadResult = await loadTranslations(code);

      if (loadResult.ok) {
        this._setStatus(t("UI.LOCALE.CHANGED", "Idioma cambiado a: {label}", {
          label: this._labelFor(code)
        }), "ok");
      } else {
        this._setStatus(t("UI.LOCALE.OFFLINE_NOTICE", "Sin conexión — mostrando idioma por defecto."), "error");
      }

      // Recarga transparente: ningún botón nuevo, es la propia acción
      // de elegir idioma la que aplica el cambio en toda la ventana.
      window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    } catch (err) {
      this._setStatus(t("UI.LOCALE.GENERIC_ERROR", "Error: {detail}", {
        detail: err.message || err
      }), "error");
      cards?.forEach(c => c.disabled = false);
    }
  }

  _setStatus(msg, kind = "info") {
    const el = this._root?.querySelector("#locale-status");
    if (!el) return;
    el.textContent = msg;
    el.className = `locale-status locale-status-${kind}`;
  }
}
