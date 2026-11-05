const path = require("path");
const fs = require("fs");
const { app } = require("electron");

// Credenciales de OAuth/Firebase para el login con Google — nunca en el
// repo. Viven en userData (fuera de git) o en variables de entorno.
const CONFIG_FILE_NAME = "google_oauth_config.json";

function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE_NAME);
}

function getOAuthConfig() {
  const fromEnv = {
    clientId: process.env.KV_GOOGLE_OAUTH_CLIENT_ID || null,
    clientSecret: process.env.KV_GOOGLE_OAUTH_CLIENT_SECRET || null,
    firebaseWebApiKey: process.env.KV_FIREBASE_WEB_API_KEY || null,
  };
  if (fromEnv.clientId && fromEnv.clientSecret && fromEnv.firebaseWebApiKey) {
    return fromEnv;
  }

  try {
    const raw = fs.readFileSync(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      clientId: fromEnv.clientId || parsed.clientId || null,
      clientSecret: fromEnv.clientSecret || parsed.clientSecret || null,
      firebaseWebApiKey: fromEnv.firebaseWebApiKey || parsed.firebaseWebApiKey || null,
    };
  } catch (_err) {
    return fromEnv;
  }
}

module.exports = { getOAuthConfig, getConfigPath };
