const DEFAULT_LOCALE = "es";

let _locale = DEFAULT_LOCALE;
let _translations = {};
let _loaded = false;

export function getLocale() {
  return _locale;
}

export function isTranslationsLoaded() {
  return _loaded;
}

export function t(key, fallback, vars) {
  if (!key) return fallback || "";
  const value = _translations[key];
  const text = typeof value === "string" ? value : (typeof fallback === "string" ? fallback : `[${key}]`);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/**
 * Carga las traducciones de `locale`: intenta el backend primero,
 * y si falla (sin red / sin sesión) cae al cache local en disco.
 * Devuelve `{ ok, source }` — source: "network" | "cache" | "none".
 */
export async function loadTranslations(locale) {
  const target = locale || _locale || DEFAULT_LOCALE;

  try {
    const resp = await window.kvClient?.apiRequest?.({
      method: "GET",
      path: "/system/locale/translations",
      query: { locale: target }
    });
    if (resp?.ok && resp.data?.translations) {
      _translations = resp.data.translations;
      _locale = target;
      _loaded = true;
      window.kvClient?.i18nWriteCache?.(target, _translations);
      return { ok: true, source: "network" };
    }
  } catch (_) {
    // sigue al fallback de disco
  }

  try {
    const cached = await window.kvClient?.i18nReadCache?.(target);
    if (cached?.ok && cached.translations) {
      _translations = cached.translations;
      _locale = target;
      _loaded = true;
      return { ok: true, source: "cache" };
    }
  } catch (_) {
    // sin cache tampoco — se queda en modo fallback inline
  }

  return { ok: false, source: "none" };
}

/**
 * Llamado una vez al arrancar la app: averigua el idioma activo
 * (si hay sesión) y precarga sus traducciones, best-effort. No bloquea
 * el primer render — mientras tanto, cada `t()` usa su fallback inline.
 */
export async function bootstrapTranslations() {
  let active = DEFAULT_LOCALE;
  try {
    const statusResp = await window.kvClient?.apiRequest?.({
      method: "GET",
      path: "/system/locale/status"
    });
    if (statusResp?.ok && statusResp.data?.locale) {
      active = statusResp.data.locale;
    }
  } catch (_) {
    // sin sesión todavía / sin red — se intenta con el default
  }
  return loadTranslations(active);
}
