const path = require("path");
const fs = require("fs");
const { app } = require("electron");

function getCachePath(locale) {
  const safeLocale = /^[a-z]{2}$/.test(String(locale || "")) ? locale : "es";
  return path.join(app.getPath("userData"), `i18n_cache_${safeLocale}.json`);
}

function readI18nCache(locale) {
  try {
    const filePath = getCachePath(locale);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.translations !== "object") {
      return null;
    }
    return { locale: parsed.locale || locale, translations: parsed.translations };
  } catch (_) {
    return null;
  }
}

function writeI18nCache(locale, translations) {
  try {
    const filePath = getCachePath(locale);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ locale, translations, cached_at: new Date().toISOString() }, null, 2),
      "utf8"
    );
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  getCachePath,
  readI18nCache,
  writeI18nCache
};
