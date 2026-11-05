const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { app } = require("electron");

const CONFIG_FILE_NAME = "view_client_config.json";

function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE_NAME);
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("base_url_required");
  }
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  if (!/^https?:$/i.test(url.protocol)) {
    throw new Error("base_url_invalid");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function generateInstanceId() {
  return crypto.randomUUID();
}

function readClientConfig() {
  const defaults = {
    base_url: process.env.KV_API_BASE_URL || "http://127.0.0.1:2030",
    api_key: process.env.KV_API_KEY || null,
    elevation_code: process.env.KV_ELEVATION_CODE || null,
    client_instance_id: null,
    connected_at: null,
  };
  try {
    const filePath = getConfigPath();
    if (!fs.existsSync(filePath)) {
      return defaults;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return defaults;
    }
    return {
      base_url: typeof parsed.base_url === "string" ? parsed.base_url : defaults.base_url,
      api_key: typeof parsed.api_key === "string" ? parsed.api_key : defaults.api_key,
      elevation_code: typeof parsed.elevation_code === "string" ? parsed.elevation_code : defaults.elevation_code,
      client_instance_id: typeof parsed.client_instance_id === "string" ? parsed.client_instance_id : null,
      connected_at: typeof parsed.connected_at === "string" ? parsed.connected_at : null,
    };
  } catch (_) {
    return defaults;
  }
}

function writeClientConfig(baseUrlOrObj, legacyApiKey) {
  const filePath = getConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  // Support legacy single-arg call: writeClientConfig(baseUrl)
  if (typeof baseUrlOrObj === "string") {
    const existing = readClientConfig();
    const data = {
      base_url: String(baseUrlOrObj),
      api_key: legacyApiKey || existing.api_key || null,
      elevation_code: existing.elevation_code || null,
      client_instance_id: existing.client_instance_id || null,
      connected_at: existing.connected_at || null,
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return;
  }

  // New-style: writeClientConfig({ base_url, api_key, elevation_code, client_instance_id, connected_at })
  const existing = readClientConfig();
  const data = {
    base_url: typeof baseUrlOrObj.base_url === "string" ? baseUrlOrObj.base_url : existing.base_url,
    api_key: typeof baseUrlOrObj.api_key === "string" ? baseUrlOrObj.api_key : existing.api_key,
    elevation_code: typeof baseUrlOrObj.elevation_code === "string" ? baseUrlOrObj.elevation_code : existing.elevation_code,
    client_instance_id: typeof baseUrlOrObj.client_instance_id === "string"
      ? baseUrlOrObj.client_instance_id
      : existing.client_instance_id,
    connected_at: typeof baseUrlOrObj.connected_at === "string"
      ? baseUrlOrObj.connected_at
      : existing.connected_at,
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

module.exports = {
  CONFIG_FILE_NAME,
  getConfigPath,
  normalizeBaseUrl,
  generateInstanceId,
  readClientConfig,
  writeClientConfig
};
