// Panel "Mi sesión" — muestra la cuenta de Google logueada y permite
// cerrar sesión (limpia el token de Firebase y vuelve a la pantalla de login).

import { t } from "../../core/i18n.js";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

export class SessionPanel {
  constructor(hostEl, deps = {}) {
    this._el = hostEl;
    this._deps = deps || {};
    this._api = deps.api || window.kvClient?.apiRequest?.bind(window.kvClient) || null;
    this._root = null;
    this._busy = false;
  }

  mount() {
    this._root = document.createElement("div");
    this._root.className = "session-root";
    this._root.innerHTML = `
      <div class="session-header">
        <span class="session-header-icon">🔑</span>
        <div>
          <div class="session-title">${t("UI.SESSION.TITLE", "Mi sesión")}</div>
          <div class="session-subtitle">${t("UI.SESSION.SUBTITLE", "Cuenta de Google conectada a KarenVision")}</div>
        </div>
      </div>
      <div class="session-body" id="session-body">
        <div class="session-loading">${t("UI.SESSION.LOADING", "Cargando…")}</div>
      </div>
    `;
    this._el.appendChild(this._root);
    this._load();
  }

  destroy() {
    this._root?.remove();
    this._root = null;
  }

  _body() {
    return this._root?.querySelector("#session-body");
  }

  async _load() {
    let info = { logged_in: false, user: null };
    try {
      const res = await window.kvClient?.getGoogleSession?.();
      if (res?.ok) info = res;
    } catch (_) {
      // deja info por defecto (sin sesión)
    }

    if (info.logged_in && info.user) {
      // El backend ya verifica el token de Firebase en cada request y ahí
      // viene el nombre real (claim "name", espejado desde Google) — más
      // confiable que lo que haya quedado guardado localmente en el login.
      // Si falla (sin red, etc.) se sigue con lo que ya había localmente.
      try {
        const who = await this._api?.({ method: "GET", path: "/client/whoami" });
        if (who?.ok && who.data?.ok) {
          info = {
            ...info,
            user: {
              ...info.user,
              name: who.data.name || info.user.name || null,
              email: who.data.email || info.user.email,
            },
          };
        }
      } catch (_) {
        // se queda con la info local
      }
    }

    this._render(info);
  }

  _render(info) {
    const body = this._body();
    if (!body) return;

    if (!info.logged_in || !info.user) {
      body.innerHTML = `
        <div class="session-card">
          <div class="session-empty">${t("UI.SESSION.EMPTY", "No hay una sesión de Google activa.")}</div>
        </div>
      `;
      return;
    }

    const { email, uid, name } = info.user;
    const initial = (name || email || "?").trim().charAt(0).toUpperCase();

    body.innerHTML = `
      <div class="session-card">
        <div class="session-account-row">
          <div class="session-avatar">${esc(initial)}</div>
          <div class="session-account-info">
            ${name ? `<div class="session-name">${esc(name)}</div>` : ""}
            <div class="session-email${name ? " session-email-secondary" : ""}">${esc(email || t("UI.SESSION.NO_EMAIL", "Sin email"))}</div>
            <div class="session-uid">UID: ${esc(uid || "—")}</div>
          </div>
        </div>
        <button class="session-btn-logout" id="session-btn-logout">${t("UI.SESSION.LOGOUT_BTN", "Cerrar sesión")}</button>
        <div class="session-feedback" id="session-feedback"></div>
      </div>
    `;

    body.querySelector("#session-btn-logout").addEventListener("click", () => this._logout());
  }

  async _logout() {
    if (this._busy) return;
    this._busy = true;
    const btn = this._root.querySelector("#session-btn-logout");
    const feedback = this._root.querySelector("#session-feedback");
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("UI.SESSION.LOGGING_OUT", "Cerrando sesión…");
    }
    try {
      await window.kvClient?.logout?.();
      await this._deps.onLoggedOut?.();
    } catch (err) {
      if (feedback) feedback.textContent = t("UI.SESSION.ERROR", "Error: {detail}", { detail: err?.message || err });
      this._busy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = t("UI.SESSION.LOGOUT_BTN", "Cerrar sesión");
      }
    }
  }
}
