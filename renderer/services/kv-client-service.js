function fallback(name) {
  return async (..._args) => ({ ok: false, error: `${name}_unavailable` });
}

const api = window.kvClient || {};

export const kvClientService = {
  getConfig: typeof api.getConfig === "function" ? (...args) => api.getConfig(...args) : fallback("get_config"),
  setConfig: typeof api.setConfig === "function" ? (...args) => api.setConfig(...args) : fallback("set_config"),
  getSessionInfo: typeof api.getSessionInfo === "function" ? (...args) => api.getSessionInfo(...args) : fallback("get_session_info"),
  login: typeof api.login === "function" ? (...args) => api.login(...args) : fallback("login"),
  logout: typeof api.logout === "function" ? (...args) => api.logout(...args) : fallback("logout"),
  getGroups: typeof api.getGroups === "function" ? (...args) => api.getGroups(...args) : fallback("get_groups"),
  getClientState: typeof api.getClientState === "function" ? (...args) => api.getClientState(...args) : fallback("get_client_state"),
  getState: typeof api.getState === "function" ? (...args) => api.getState(...args) : fallback("get_state"),
  duplicateWindow: typeof api.duplicateWindow === "function" ? (...args) => api.duplicateWindow(...args) : fallback("duplicate_window"),
  detachWindow: typeof api.detachWindow === "function" ? (...args) => api.detachWindow(...args) : fallback("detach_window"),
  detachStatus: typeof api.detachStatus === "function" ? (...args) => api.detachStatus(...args) : fallback("detach_status"),
  onDetachClosed: typeof api.onDetachClosed === "function" ? (...args) => api.onDetachClosed(...args) : () => () => {},
  streamToken: typeof api.streamToken === "function" ? (...args) => api.streamToken(...args) : fallback("stream_token")
};

