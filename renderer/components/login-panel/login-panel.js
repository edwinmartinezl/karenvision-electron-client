// Pantalla de login. Dos modos, elegidos automáticamente según haya o no
// internet real (chequeado en el proceso main — ver main/net/connectivity.js,
// la CSP del renderer bloquea fetch a hosts externos):
//
//   - "google": el flujo normal, Firebase Auth vía Google (loopback OAuth).
//   - "code": login manual sin usuario, con un código de 6 dígitos
//     (POST /view/login, ver karenvision/api/services/view_service.py) —
//     se activa solo cuando no hay internet, porque sin internet el login
//     de Google nunca puede completarse (ver colaboracion/054).

const GOOGLE_ICON_SVG = `
<svg class="login-btn-icon" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.02l7.73 6c4.51-4.18 7.09-10.36 7.09-17.49z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>
`.trim();

const SPINNER_SVG = `
<span class="login-spinner" aria-hidden="true"></span>
`.trim();

const CODE_LENGTH = 6;

const CODE_ERROR_MESSAGES = {
  invalid_code: "Código incorrecto.",
  client_disabled: "Este código fue deshabilitado.",
  base_url_required: "No se pudo determinar la URL del SDK.",
};

export class LoginPanel {
  constructor(rootEl, deps = {}) {
    this._el = rootEl;
    this._deps = deps || {};
    this._root = null;
    this._busy = false;
    this._mode = "checking"; // "checking" | "google" | "code"
    this._unbind = null;
  }

  mount() {
    if (!this._el) return;
    this._root = document.createElement("div");
    this._root.className = "login-card";
    this._el.innerHTML = "";
    this._el.appendChild(this._root);
    this._detectAndRender();
  }

  destroy() {
    this._unbind?.();
    this._unbind = null;
    this._root?.remove();
    this._root = null;
  }

  // Se llama cada vez que la app está por mostrar la pantalla de login (boot,
  // reconexión tras sesión vencida) para que el chequeo de "hay internet"
  // sea del momento, no el de cuando se montó el componente al arrancar.
  refreshMode() {
    this._detectAndRender();
  }

  // Se puede llamar de nuevo cada vez que se vuelve a mostrar la pantalla
  // de login (boot, reconexión tras cerrar sesión) para que el chequeo de
  // internet esté siempre fresco.
  async _detectAndRender() {
    this._mode = "checking";
    this._renderChecking();
    let online = true;
    try {
      const resp = await window.kvClient?.checkInternet?.();
      // Si el chequeo mismo falla (IPC caído, etc.), asume que hay internet
      // — es el comportamiento previo a este cambio, no empeora nada.
      online = resp?.ok ? Boolean(resp.online) : true;
    } catch (_err) {
      online = true;
    }
    this._mode = online ? "google" : "code";
    this._render();
  }

  _renderChecking() {
    if (!this._root) return;
    this._unbind?.();
    this._unbind = null;
    this._root.innerHTML = `
      <div class="login-logo" aria-hidden="true"></div>
      <div class="login-title">KARENVISION</div>
      <div class="login-subtitle">Verificando conexión…</div>
      <span class="login-spinner login-spinner-standalone" aria-hidden="true"></span>
    `;
  }

  _render() {
    if (!this._root) return;
    this._unbind?.();
    this._unbind = this._mode === "code" ? this._renderCode() : this._renderGoogle();
  }

  // ── Modo Google ────────────────────────────────────────────────────────

  _renderGoogle() {
    this._root.innerHTML = `
      <div class="login-logo" aria-hidden="true"></div>
      <div class="login-title">KARENVISION</div>
      <div class="login-subtitle">Sistema de videovigilancia inteligente</div>

      <button type="button" class="login-btn-google" id="login-btn-google">
        ${GOOGLE_ICON_SVG}
        <span class="login-btn-label">Continuar con Google</span>
      </button>

      <div class="login-error" id="login-error" hidden></div>

      <button type="button" class="login-link-alt" id="login-link-use-code">
        ¿Sin internet? Iniciar con código
      </button>

      <div class="login-footer">
        <span>Política de privacidad</span>
        <span class="login-footer-sep">·</span>
        <span>Términos de servicio</span>
        <span class="login-footer-sep">·</span>
        <span>v1.0.0</span>
      </div>
    `;

    const btn = this._root.querySelector("#login-btn-google");
    const btnLabel = this._root.querySelector(".login-btn-label");
    const errorEl = this._root.querySelector("#login-error");
    const useCodeLink = this._root.querySelector("#login-link-use-code");

    const setBusy = (busy) => {
      this._busy = busy;
      btn.disabled = busy;
      btn.classList.toggle("is-busy", busy);
      const icon = btn.querySelector(".login-btn-icon, .login-spinner");
      if (icon) icon.outerHTML = busy ? SPINNER_SVG : GOOGLE_ICON_SVG;
      if (btnLabel) btnLabel.textContent = busy ? "Conectando..." : "Continuar con Google";
    };

    const showError = (reason) => {
      console.error("[LoginPanel] Google login failed:", reason);
      errorEl.textContent = "No se pudo conectar. Intenta de nuevo.";
      errorEl.hidden = false;
    };

    const onClick = async () => {
      if (this._busy) return;
      errorEl.hidden = true;
      errorEl.textContent = "";
      setBusy(true);
      try {
        const resp = await window.kvClient?.loginWithGoogle?.();
        if (resp?.ok) {
          await this._deps.onLoginSuccess?.(resp);
        } else {
          showError(resp?.error);
        }
      } catch (err) {
        showError(err?.message || String(err));
      } finally {
        setBusy(false);
      }
    };

    // Salida manual: el usuario puede saltar al login por código aunque el
    // chequeo automático haya dado "hay internet" (falso negativo/positivo,
    // red intermitente, etc.) sin tener que esperar a que Google falle.
    const onUseCode = () => {
      this._mode = "code";
      this._render();
    };

    btn.addEventListener("click", onClick);
    useCodeLink.addEventListener("click", onUseCode);
    return () => {
      btn.removeEventListener("click", onClick);
      useCodeLink.removeEventListener("click", onUseCode);
    };
  }

  // ── Modo código (login manual, sin internet) ────────────────────────────

  _renderCode() {
    this._root.innerHTML = `
      <div class="login-logo" aria-hidden="true"></div>
      <div class="login-title">KARENVISION</div>
      <div class="login-subtitle login-subtitle-warn">
        Sin conexión a internet. Iniciá sesión con el código de acceso local.
      </div>

      <form id="login-code-form" class="login-code-form" autocomplete="off">
        <input
          type="text"
          id="login-code-input"
          class="login-code-input"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="${CODE_LENGTH}"
          placeholder="000000"
          aria-label="Código de acceso de 6 dígitos"
        />
        <button type="submit" class="login-btn-google" id="login-btn-code">
          <span class="login-btn-label">Ingresar</span>
        </button>
      </form>

      <div class="login-error" id="login-error" hidden></div>

      <button type="button" class="login-link-alt" id="login-link-retry">
        Reintentar conexión con Google
      </button>

      <div class="login-footer">
        <span>Política de privacidad</span>
        <span class="login-footer-sep">·</span>
        <span>Términos de servicio</span>
        <span class="login-footer-sep">·</span>
        <span>v1.0.0</span>
      </div>
    `;

    const form = this._root.querySelector("#login-code-form");
    const input = this._root.querySelector("#login-code-input");
    const btn = this._root.querySelector("#login-btn-code");
    const btnLabel = btn.querySelector(".login-btn-label");
    const errorEl = this._root.querySelector("#login-error");
    const retryLink = this._root.querySelector("#login-link-retry");

    const setBusy = (busy) => {
      this._busy = busy;
      btn.disabled = busy;
      input.disabled = busy;
      btnLabel.textContent = busy ? "Ingresando..." : "Ingresar";
    };

    const showError = (message) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
    };

    const onInput = () => {
      const digitsOnly = input.value.replace(/\D+/g, "").slice(0, CODE_LENGTH);
      if (digitsOnly !== input.value) input.value = digitsOnly;
      errorEl.hidden = true;
    };

    const onSubmit = async (evt) => {
      evt.preventDefault();
      if (this._busy) return;
      const code = input.value.trim();
      if (!/^\d{6}$/.test(code)) {
        showError(`El código debe tener ${CODE_LENGTH} dígitos.`);
        return;
      }
      setBusy(true);
      try {
        const baseUrl = this._deps.getBaseUrl?.();
        const resp = await window.kvClient?.login?.({ code, base_url: baseUrl });
        if (resp?.ok) {
          await this._deps.onLoginSuccess?.(resp);
        } else {
          showError(CODE_ERROR_MESSAGES[resp?.error] || "No se pudo iniciar sesión. Intenta de nuevo.");
        }
      } catch (err) {
        showError(err?.message || String(err));
      } finally {
        setBusy(false);
      }
    };

    const onRetry = () => {
      this._detectAndRender();
    };

    input.addEventListener("input", onInput);
    form.addEventListener("submit", onSubmit);
    retryLink.addEventListener("click", onRetry);
    input.focus();

    return () => {
      input.removeEventListener("input", onInput);
      form.removeEventListener("submit", onSubmit);
      retryLink.removeEventListener("click", onRetry);
    };
  }
}
