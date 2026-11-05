// Result renderers for each command.
// Each renderer receives the API response data and returns a DOM element.

function esc(v) {
  return String(v ?? "—").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function badge(text, cls) {
  return `<span class="cmd-badge ${esc(cls)}">${esc(text)}</span>`;
}

// ─── Stack navigation inside the result panel ────────────────────

function makeStack(initial) {
  const wrap = document.createElement("div");
  wrap.className = "cmd-result-stack";

  function push(el, title) {
    const frame = document.createElement("div");
    frame.className = "cmd-result-frame";

    if (wrap.children.length > 0) {
      const back = document.createElement("button");
      back.className = "cmd-result-back";
      back.innerHTML = "← Volver";
      back.addEventListener("click", () => {
        frame.remove();
        wrap.lastElementChild?.classList.remove("cmd-hidden");
      });
      const backRow = document.createElement("div");
      backRow.className = "cmd-result-back-row";
      if (title) {
        backRow.innerHTML = `<span class="cmd-result-detail-title">${esc(title)}</span>`;
      }
      backRow.prepend(back);
      frame.appendChild(backRow);
      wrap.lastElementChild?.classList.add("cmd-hidden");
    }

    frame.appendChild(el);
    wrap.appendChild(frame);
  }

  push(initial);
  return { root: wrap, push };
}

// ─── Shared building blocks ───────────────────────────────────────

function kvTable(obj, opts = {}) {
  const el = document.createElement("div");
  el.className = "cmd-kv-table";
  const entries = Object.entries(obj);
  if (!entries.length) {
    el.innerHTML = `<div class="cmd-result-empty">Sin datos</div>`;
    return el;
  }
  el.innerHTML = entries.map(([k, v]) => {
    let display;
    if (v === null || v === undefined) {
      display = `<span class="cmd-kv-null">null</span>`;
    } else if (typeof v === "boolean") {
      display = badge(v ? "true" : "false", v ? "ok" : "muted");
    } else if (typeof v === "object") {
      display = `<code class="cmd-kv-code">${esc(JSON.stringify(v))}</code>`;
    } else {
      display = `<span class="cmd-kv-val">${esc(v)}</span>`;
    }
    return `<div class="cmd-kv-row"><span class="cmd-kv-key">${esc(k)}</span>${display}</div>`;
  }).join("");
  return el;
}

function resultHeader(text) {
  const el = document.createElement("div");
  el.className = "cmd-result-count";
  el.textContent = text;
  return el;
}

function emptyResult(text = "Sin resultados") {
  const el = document.createElement("div");
  el.className = "cmd-result-empty";
  el.textContent = text;
  return el;
}

function okBanner(data) {
  const el = document.createElement("div");
  el.className = "cmd-result-ok";
  const msg = data?.message || data?.detail || (data?.ok === true ? "Operación completada" : null);
  el.innerHTML = `<span class="cmd-ok-icon">✓</span><span>${esc(msg || "ok")}</span>`;
  if (data && typeof data === "object") {
    el.appendChild(kvTable(data));
  }
  return el;
}

// ─── Registry ────────────────────────────────────────────────────

const RENDERERS = {};

export function renderResult(cmdId, data, ok, ctx = {}) {
  if (!ok) return renderError(data);
  const fn = RENDERERS[cmdId];
  if (fn) return fn(data, ctx);
  return renderGeneric(data);
}

function renderError(data) {
  const el = document.createElement("div");
  el.className = "cmd-result-error";
  const msg = data?.detail || data?.error || data?.message || "Error desconocido";
  el.innerHTML = `<span class="cmd-err-icon">✗</span><span>${esc(msg)}</span>`;
  if (data && typeof data === "object") {
    const kv = kvTable(data);
    kv.style.marginTop = "8px";
    el.appendChild(kv);
  }
  return el;
}

function renderGeneric(data) {
  if (data === null || data === undefined) return emptyResult();
  if (Array.isArray(data)) {
    const wrap = document.createElement("div");
    wrap.appendChild(resultHeader(`${data.length} elemento${data.length !== 1 ? "s" : ""}`));
    data.forEach((item, i) => {
      wrap.appendChild(typeof item === "object" ? kvTable(item) : (() => {
        const d = document.createElement("div");
        d.className = "cmd-result-scalar";
        d.textContent = String(item);
        return d;
      })());
      if (i < data.length - 1) {
        const sep = document.createElement("div");
        sep.className = "cmd-result-sep";
        wrap.appendChild(sep);
      }
    });
    return wrap;
  }
  if (typeof data === "object") return kvTable(data);
  const el = document.createElement("div");
  el.className = "cmd-result-scalar";
  el.textContent = String(data);
  return el;
}

// ─── camera ──────────────────────────────────────────────────────

RENDERERS["camera.list"] = (data) => {
  if (!Array.isArray(data)) return renderGeneric(data);
  const list = document.createElement("div");
  list.appendChild(resultHeader(`${data.length} cámara${data.length !== 1 ? "s" : ""}`));

  const stack = makeStack(list);

  if (!data.length) { list.appendChild(emptyResult("Sin cámaras registradas")); return stack.root; }

  data.forEach(cam => {
    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <span class="cmd-ch-badge">CH${esc(cam.channel)}</span>
      <div class="cmd-row-main">
        <div class="cmd-row-title">${esc(cam.camera_id || `channel_${cam.channel}`)}</div>
        <div class="cmd-row-sub">${esc(cam.ip)}:${esc(cam.rtsp_port || 554)}</div>
      </div>
      ${badge(cam.brand || "?", "brand")}
      <span class="cmd-dot ${cam.enabled ? "active" : "inactive"}" title="${cam.enabled ? "Habilitada" : "Deshabilitada"}"></span>
    `;
    row.addEventListener("click", () => stack.push(kvTable(cam), `Cámara CH${cam.channel}`));
    list.appendChild(row);
  });
  return stack.root;
};

RENDERERS["camera.add"]    = okBanner;
RENDERERS["camera.update"] = okBanner;
RENDERERS["camera.remove"] = okBanner;

// ─── group ───────────────────────────────────────────────────────

RENDERERS["group.list"] = (data) => {
  const groups = Array.isArray(data) ? data : (data?.groups || []);
  const list = document.createElement("div");
  list.appendChild(resultHeader(`${groups.length} grupo${groups.length !== 1 ? "s" : ""}`));
  const stack = makeStack(list);

  if (!groups.length) { list.appendChild(emptyResult("Sin grupos")); return stack.root; }

  groups.forEach(g => {
    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <div class="cmd-row-main">
        <div class="cmd-row-title">${esc(g.name || g.identifier || g.id)}</div>
        <div class="cmd-row-sub">${esc(g.title || g.description || "")}</div>
      </div>
      ${badge((g.cameras?.length ?? g.channel_count ?? "—") + " cámaras", "muted")}
    `;
    row.addEventListener("click", () => stack.push(kvTable(g), g.name || g.id));
    list.appendChild(row);
  });
  return stack.root;
};

RENDERERS["group.show"]         = (d) => { const s = makeStack(kvTable(d), d?.name); return s.root; };
RENDERERS["group.create"]       = okBanner;
RENDERERS["group.add-camera"]   = okBanner;
RENDERERS["group.remove-camera"]= okBanner;
RENDERERS["group.grid.set"]     = okBanner;
RENDERERS["group.delete"]       = okBanner;

// ─── service ─────────────────────────────────────────────────────

RENDERERS["service.status"] = (data, { api } = {}) => {
  const services = data?.services || (Array.isArray(data) ? data : []);
  const list = document.createElement("div");
  list.appendChild(resultHeader(`${services.length} servicio${services.length !== 1 ? "s" : ""}`));
  const stack = makeStack(list);

  if (!services.length) { list.appendChild(emptyResult("Sin servicios")); return stack.root; }

  services.forEach(svc => {
    const state  = String(svc.state  || "").toLowerCase();
    const status = String(svc.status || "").toLowerCase();
    const isOk   = state === "active" && (status === "running" || status === "active");
    const isWarn = status.includes("restart") || status.includes("reconnect") || state === "activating";
    const stateClass = isOk ? "ok" : isWarn ? "warn" : "err";

    const nrestarts = svc.nrestarts != null ? Number(svc.nrestarts) : null;
    const restartNote = nrestarts > 0
      ? `<span class="cmd-muted" style="font-size:11px;margin-left:6px;">↺ ${nrestarts.toLocaleString()} reinicios</span>`
      : "";

    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <span class="cmd-ch-badge">CH${esc(svc.channel ?? "?")}</span>
      <div class="cmd-row-main">
        <div class="cmd-row-title">${esc(svc.description || svc.service || "servicio")}${restartNote}</div>
        <div class="cmd-row-sub">${esc(svc.service || "")} · último cambio: ${esc(svc.state_change_timestamp || svc.active_enter_timestamp || "—")}</div>
      </div>
      ${badge(svc.state || "—", stateClass)}
      ${svc.status !== svc.state ? badge(svc.status || "", stateClass) : ""}
    `;

    row.addEventListener("click", async () => {
      const detail = document.createElement("div");
      detail.className = "cmd-stack-page";

      // Key-value table with enriched fields
      const fieldsToShow = {
        "Servicio":        svc.service,
        "Estado":          svc.state,
        "Subestado":       svc.status,
        "Resultado":       svc.result,
        "Reinicios":       svc.nrestarts,
        "PID":             svc.pid,
        "Código salida":   svc.exec_status,
        "Archivo unidad":  svc.unit_file_state,
        "Últ. cambio":     svc.state_change_timestamp,
        "Entró activo":    svc.active_enter_timestamp,
      };
      const tbl = document.createElement("div");
      tbl.className = "cmd-kv-table";
      tbl.innerHTML = Object.entries(fieldsToShow)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `<div class="cmd-kv-row"><span class="cmd-kv-key">${esc(k)}</span><span class="cmd-kv-val">${esc(String(v))}</span></div>`)
        .join("");
      detail.appendChild(tbl);

      // Log section
      const logSection = document.createElement("div");
      logSection.style.marginTop = "14px";
      const logTitle = document.createElement("div");
      logTitle.className = "cmd-section-label";
      logTitle.textContent = "Últimas entradas del sistema";
      logSection.appendChild(logTitle);

      const logBox = document.createElement("div");
      logBox.className = "cmd-log-box";
      logBox.textContent = "Cargando…";
      logSection.appendChild(logBox);
      detail.appendChild(logSection);

      stack.push(detail, `Servicio CH${svc.channel}`);

      // Fetch logs via IPC
      try {
        const resp = await (api || window.kvClient?.apiRequest?.bind(window.kvClient))?.({
          method: "GET",
          path: "/service/logs",
          query: { channel: svc.channel, lines: 30 }
        });
        if (resp?.ok && Array.isArray(resp.data?.lines)) {
          logBox.textContent = resp.data.lines.join("\n") || "(sin entradas)";
        } else {
          logBox.textContent = "(no se pudieron cargar los registros)";
        }
      } catch (_) {
        logBox.textContent = "(error al cargar registros)";
      }
    });

    list.appendChild(row);
  });
  return stack.root;
};

RENDERERS["service.control"] = okBanner;

// ─── channel ─────────────────────────────────────────────────────

RENDERERS["channel.status"] = (data) => {
  const channels = Array.isArray(data) ? data : (data?.channels || (data ? [data] : []));
  if (channels.length === 1) {
    const s = makeStack(kvTable(channels[0]));
    return s.root;
  }
  const list = document.createElement("div");
  list.appendChild(resultHeader(`${channels.length} canal${channels.length !== 1 ? "es" : ""}`));
  const stack = makeStack(list);
  channels.forEach(ch => {
    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <span class="cmd-ch-badge">CH${esc(ch.channel ?? ch.id ?? "?")}</span>
      <div class="cmd-row-main">
        <div class="cmd-row-title">${esc(ch.camera_id || `canal ${ch.channel}`)}</div>
      </div>
    `;
    row.addEventListener("click", () => stack.push(kvTable(ch), `Canal ${ch.channel}`));
    list.appendChild(row);
  });
  return stack.root;
};

// ─── record ──────────────────────────────────────────────────────

RENDERERS["record.init"]   = okBanner;
RENDERERS["record.start"]  = okBanner;
RENDERERS["record.stop"]   = okBanner;
RENDERERS["record.remove"] = okBanner;

// ─── storage ─────────────────────────────────────────────────────

RENDERERS["storage.path.get"] = (d) => {
  const wrap = document.createElement("div");
  wrap.className = "cmd-stor-nvr";
  wrap.innerHTML = `
    <div class="cmd-stor-nvr-row">
      <span class="cmd-stor-nvr-label">Canal ${esc(d?.channel ?? "?")}</span>
    </div>
    <div class="cmd-kv-row"><span class="cmd-kv-key">Ruta activa</span><span class="cmd-kv-val cmd-kv-mono">${esc(d?.active_path || "—")}</span></div>
    ${Array.isArray(d?.history) && d.history.length > 1 ? `
      <div class="cmd-kv-row"><span class="cmd-kv-key">Historial</span><span class="cmd-kv-val">${d.history.length} rutas anteriores</span></div>
    ` : ""}
  `;
  const s = makeStack(wrap);
  return s.root;
};
RENDERERS["storage.path.set"]    = okBanner;
RENDERERS["storage.path.change"] = okBanner;

RENDERERS["storage.usage"] = (data) => {
  const fmtB = (b) => {
    if (b == null) return "—";
    if (b >= 1e12) return (b / 1e12).toFixed(2) + " TB";
    if (b >= 1e9)  return (b / 1e9).toFixed(1) + " GB";
    if (b >= 1e6)  return (b / 1e6).toFixed(0) + " MB";
    return (b / 1e3).toFixed(0) + " KB";
  };
  const pctOf = (used, total) => (!total ? 0 : Math.min(100, Math.round((used / total) * 100)));
  const medIcon = { local: "🖥", network: "🌐", cloud: "☁", unknown: "?" };

  const entries = Array.isArray(data) ? data : (data?.channels || (data ? [data] : []));
  const nvr = data?.nvr;

  const list = document.createElement("div");

  // NVR total pill
  if (nvr) {
    const nvrPct = pctOf(nvr.used_bytes, nvr.assigned_bytes);
    const nvrColor = nvrPct >= 90 ? "#ef4444" : nvrPct >= 70 ? "#f59e0b" : "#22c55e";
    const nvrEl = document.createElement("div");
    nvrEl.className = "cmd-stor-nvr";
    nvrEl.innerHTML = `
      <div class="cmd-stor-nvr-row">
        <span class="cmd-stor-nvr-label">Total NVR</span>
        <span class="cmd-stor-nums">${fmtB(nvr.used_bytes)} <span class="cmd-stor-sep">de</span> ${fmtB(nvr.assigned_bytes)}</span>
        <span class="cmd-stor-pct" data-color="${nvrColor}">${nvrPct}%</span>
      </div>
      <div class="cmd-usage-bar-wrap">
        <div class="cmd-usage-bar" data-color="${nvrColor}" data-width="${nvrPct}"></div>
      </div>
      <div class="cmd-stor-free">Libre: ${fmtB(nvr.free_bytes)}</div>
    `;
    list.appendChild(nvrEl);
  }

  list.appendChild(resultHeader(`${entries.length} canal${entries.length !== 1 ? "es" : ""}`));
  const stack = makeStack(list);

  entries.forEach(e => {
    const pct      = pctOf(e.used_bytes, e.assigned_bytes);
    const hasQuota = e.assigned_bytes != null;
    const barColor = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#22c55e";
    const med      = e.medium || "unknown";

    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <span class="cmd-ch-badge">CH${esc(e.channel ?? "?")}</span>
      <div class="cmd-row-main">
        <div class="cmd-stor-ch-top">
          <span class="cmd-row-title">${fmtB(e.used_bytes)}${hasQuota ? ` <span class="cmd-stor-sep">de</span> ${fmtB(e.assigned_bytes)}` : " <span class=\"cmd-stor-noquota\">sin cuota</span>"}</span>
          <span class="cmd-stor-med">${medIcon[med] ?? "?"} ${med}</span>
        </div>
        ${hasQuota ? `
          <div class="cmd-usage-bar-wrap">
            <div class="cmd-usage-bar" data-color="${barColor}" data-width="${pct}"></div>
          </div>
          <div class="cmd-row-sub">${pct}% usado · libre: ${fmtB(e.free_bytes)}</div>
        ` : `<div class="cmd-row-sub">usado: ${fmtB(e.used_bytes)}</div>`}
        <div class="cmd-stor-path">${esc(e.active_path || "—")}</div>
      </div>
    `;
    row.addEventListener("click", () => {
      const detail = document.createElement("div");
      detail.className = "cmd-stor-detail";
      detail.innerHTML = `
        <div class="cmd-kv-row"><span class="cmd-kv-key">Canal</span><span class="cmd-kv-val">${esc(e.channel)}</span></div>
        <div class="cmd-kv-row"><span class="cmd-kv-key">Medio</span><span class="cmd-kv-val">${medIcon[med] ?? "?"} ${med}</span></div>
        <div class="cmd-kv-row"><span class="cmd-kv-key">Usado</span><span class="cmd-kv-val">${fmtB(e.used_bytes)}</span></div>
        <div class="cmd-kv-row"><span class="cmd-kv-key">Cuota</span><span class="cmd-kv-val">${fmtB(e.assigned_bytes)}</span></div>
        <div class="cmd-kv-row"><span class="cmd-kv-key">Libre</span><span class="cmd-kv-val">${fmtB(e.free_bytes)}</span></div>
        <div class="cmd-kv-row"><span class="cmd-kv-key">Ocupado</span><span class="cmd-kv-val">${hasQuota ? pct + "%" : "—"}</span></div>
        <div class="cmd-kv-row"><span class="cmd-kv-key">Ruta</span><span class="cmd-kv-val cmd-kv-mono">${esc(e.active_path || "—")}</span></div>
        <div class="cmd-kv-row"><span class="cmd-kv-key">Particiones</span><span class="cmd-kv-val">${esc(e.storages ?? "—")}</span></div>
      `;
      stack.push(detail, `Canal ${e.channel}`);
    });
    list.appendChild(row);

    requestAnimationFrame(() => {
      row.querySelectorAll(".cmd-usage-bar[data-width]").forEach(b => {
        b.style.width = b.dataset.width + "%";
        b.style.background = b.dataset.color;
      });
    });
  });

  requestAnimationFrame(() => {
    list.querySelectorAll(".cmd-usage-bar[data-width]").forEach(b => {
      b.style.width = b.dataset.width + "%";
      b.style.background = b.dataset.color;
    });
    list.querySelectorAll(".cmd-stor-pct[data-color]").forEach(b => {
      b.style.color = b.dataset.color;
    });
  });

  return stack.root;
};

// ─── timeline ────────────────────────────────────────────────────

RENDERERS["timeline.show"] = (data) => {
  const entries = data?.entries || data?.segments || (Array.isArray(data) ? data : []);
  const list = document.createElement("div");
  list.appendChild(resultHeader(`${entries.length} segmento${entries.length !== 1 ? "s" : ""}`));
  const stack = makeStack(list);

  if (!entries.length) { list.appendChild(emptyResult("Timeline vacío")); return stack.root; }

  entries.forEach((seg, i) => {
    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <span class="cmd-ch-badge">#${i + 1}</span>
      <div class="cmd-row-main">
        <div class="cmd-row-title">${esc(seg.from || seg.start || seg.ts_start || "—")}</div>
        <div class="cmd-row-sub">→ ${esc(seg.to || seg.end || seg.ts_end || "—")}</div>
      </div>
      ${badge(esc(seg.size || seg.duration || ""), "muted")}
    `;
    row.addEventListener("click", () => stack.push(kvTable(seg), `Segmento #${i + 1}`));
    list.appendChild(row);
  });
  return stack.root;
};

RENDERERS["timeline.build"] = okBanner;
RENDERERS["timeline.clear"] = okBanner;

// ─── quota ───────────────────────────────────────────────────────

function _fmtBytes(b) {
  if (b == null) return "—";
  if (b >= 1e12) return (b/1e12).toFixed(2) + " TB";
  if (b >= 1e9)  return (b/1e9).toFixed(2) + " GB";
  if (b >= 1e6)  return (b/1e6).toFixed(1) + " MB";
  return (b/1e3).toFixed(0) + " KB";
}

function _fmtDuration(totalSeconds) {
  if (totalSeconds == null || !isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.round(totalSeconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} día${d !== 1 ? "s" : ""}`);
  if (h) parts.push(`${h} h`);
  if (m || (!d && !h)) parts.push(`${m} min`);
  return parts.join(" ");
}

// Shared usage + calc fetch — called once per quota.status render for all channels
async function _fetchQuotaDetails(channels, api) {
  const [usageRes, ...calcResults] = await Promise.allSettled([
    api({ method: "GET", path: "/storage/usage" }),
    ...channels
      .filter(ch => ch.quota?.assigned && ch.quota?.limit_bytes)
      .map(ch => api({ method: "POST", path: "/calc/run", body: { expr: "1gb/h", channel: String(ch.channel) } }))
  ]);

  const usageByChannel = {};
  for (const row of (usageRes.value?.data?.channels || [])) {
    usageByChannel[row.channel] = row;
  }

  const rateByChannel = {};
  const quotaChannels = channels.filter(ch => ch.quota?.assigned && ch.quota?.limit_bytes);
  calcResults.forEach((r, i) => {
    const chNum = quotaChannels[i]?.channel;
    const val = r.value?.data?.results?.[0]?.value;
    if (chNum && val) rateByChannel[chNum] = val; // GB/h
  });

  return { usageByChannel, rateByChannel };
}

// Escalones de cuota en GB
const QUOTA_STEPS_GB = [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000, 2000];

function _gbLabel(gb) {
  if (gb >= 1000) return (gb / 1000) % 1 === 0 ? `${gb/1000} TB` : `${(gb/1000).toFixed(1)} TB`;
  return `${gb} GB`;
}

function _bytesToStepIdx(limitBytes) {
  const gb = limitBytes ? limitBytes / 1e9 : 0;
  let best = 0;
  for (let i = 0; i < QUOTA_STEPS_GB.length; i++) {
    if (Math.abs(QUOTA_STEPS_GB[i] - gb) < Math.abs(QUOTA_STEPS_GB[best] - gb)) best = i;
  }
  return best;
}

function _buildQuotaCard(ch, api) {
  const q  = ch.quota      || {};
  const qm = ch.quota_mode || {};
  const hasQuota  = q.assigned && q.limit_bytes;
  const currentGB = hasQuota ? Math.round(q.limit_bytes / 1e9) : null;
  let   stepIdx   = hasQuota ? _bytesToStepIdx(q.limit_bytes) : 4; // default 50 GB

  const card = document.createElement("div");
  card.className = "cmd-quota-card";

  const recBadge = ch.recording_runtime?.active
    ? `<span class="cmd-q-badge cmd-q-rec-on">● Grabando</span>` : "";

  card.innerHTML = `
    <div class="cmd-quota-ch-header">
      <span class="cmd-quota-ch-num">Canal ${esc(ch.channel)}</span>
      <div class="cmd-quota-badges">${recBadge}</div>
    </div>
    <div class="cmd-quota-meta">${esc(ch.camera?.brand || "—")} · ${esc(ch.camera?.ip || "—")}</div>

    <div class="cmd-quota-usage-block" id="qu-${ch.channel}">
      ${hasQuota ? `<span class="cmd-q-loading">Calculando uso…</span>` : `<span class="cmd-q-no-usage">Sin cuota asignada</span>`}
    </div>

    <div class="cmd-q-editor">
      <div class="cmd-q-section-title">${hasQuota ? "Ajustar espacio de grabación" : "Asignar espacio de grabación"}</div>

      <div class="cmd-q-stepper">
        <button class="cmd-q-step-btn" id="qminus-${ch.channel}">−</button>
        <div class="cmd-q-step-val" id="qval-${ch.channel}">${_gbLabel(QUOTA_STEPS_GB[stepIdx])}</div>
        <button class="cmd-q-step-btn" id="qplus-${ch.channel}">+</button>
      </div>
      <div class="cmd-q-step-hint">
        ${hasQuota ? `Actual: <strong>${esc(q.limit_human || _fmtBytes(q.limit_bytes))}</strong> · ` : ""}
        Usa − y + para ajustar, o escribe:
        <input class="cmd-q-custom-input" id="qcustom-${ch.channel}" type="text" placeholder="ej. 75GB" />
      </div>

      <div class="cmd-q-fifo-section">
        <div class="cmd-q-section-title">Reciclado automático (FIFO)</div>
        <div class="cmd-q-fifo-row">
          <div class="cmd-q-fifo-info" id="qfifo-info-${ch.channel}">
            ${qm.policy_configured
              ? (qm.active
                  ? `<span class="cmd-q-badge cmd-q-fifo-on">Activo ahora</span> Se borraron videos para liberar espacio`
                  : `<span class="cmd-q-badge cmd-q-fifo-cfg">Configurado</span> Se activa cuando el disco llegue al <strong>${esc(qm.threshold_percent ?? "?")}%</strong>${qm.target_percent != null ? ` y libera hasta el <strong>${esc(qm.target_percent)}%</strong>` : ""}`)
              : `<span class="cmd-q-badge cmd-q-fifo-off">Sin configurar</span> Los videos más antiguos <strong>no</strong> se borran automáticamente`
            }
          </div>
        </div>
      </div>

      <div class="cmd-q-save-row">
        <div class="cmd-q-feedback" id="qf-${ch.channel}"></div>
        <button class="cmd-q-apply-btn" id="qa-${ch.channel}">Guardar</button>
      </div>
    </div>
  `;

  // ── Stepper lógica ────────────────────────────────────────────────
  const valEl    = card.querySelector(`#qval-${ch.channel}`);
  const minusBtn = card.querySelector(`#qminus-${ch.channel}`);
  const plusBtn  = card.querySelector(`#qplus-${ch.channel}`);
  const customEl = card.querySelector(`#qcustom-${ch.channel}`);
  const applyBtn = card.querySelector(`#qa-${ch.channel}`);
  const feedback = card.querySelector(`#qf-${ch.channel}`);

  function refreshStepperDisplay() {
    valEl.textContent = _gbLabel(QUOTA_STEPS_GB[stepIdx]);
    minusBtn.disabled = stepIdx <= 0;
    plusBtn.disabled  = stepIdx >= QUOTA_STEPS_GB.length - 1;
  }
  refreshStepperDisplay();

  minusBtn.addEventListener("click", () => {
    if (stepIdx > 0) { stepIdx--; customEl.value = ""; refreshStepperDisplay(); }
  });
  plusBtn.addEventListener("click", () => {
    if (stepIdx < QUOTA_STEPS_GB.length - 1) { stepIdx++; customEl.value = ""; refreshStepperDisplay(); }
  });

  customEl.addEventListener("input", () => {
    const raw = customEl.value.trim().toUpperCase();
    if (!raw) { refreshStepperDisplay(); return; }
    valEl.textContent = raw;
  });

  applyBtn.addEventListener("click", async () => {
    if (!api) return;
    const customRaw = customEl.value.trim();
    const sizeStr   = customRaw || (QUOTA_STEPS_GB[stepIdx] >= 1000
      ? `${QUOTA_STEPS_GB[stepIdx] / 1000}TB`
      : `${QUOTA_STEPS_GB[stepIdx]}GB`);

    applyBtn.disabled  = true;
    applyBtn.textContent = "Guardando…";
    feedback.className = "cmd-q-feedback";
    feedback.textContent = "";

    const endpoint = hasQuota ? "/quota/change" : "/quota/set";
    try {
      const res = await api({ method: "POST", path: endpoint, body: { channel: ch.channel, size: sizeStr } });
      if (res?.ok) {
        feedback.className   = "cmd-q-feedback ok";
        feedback.textContent = `✓ Espacio actualizado a ${sizeStr}`;
        const hint = card.querySelector(".cmd-q-step-hint strong");
        if (hint) hint.textContent = sizeStr;
      } else {
        feedback.className   = "cmd-q-feedback err";
        feedback.textContent = `✗ ${res?.data?.detail || res?.data?.error || "No se pudo guardar"}`;
      }
    } catch {
      feedback.className   = "cmd-q-feedback err";
      feedback.textContent = "✗ Error de conexión";
    }
    applyBtn.disabled  = false;
    applyBtn.textContent = "Guardar";
  });

  return card;
}

RENDERERS["quota.status"] = (data, { api } = {}) => {
  const allChannels = data?.channels || [];
  const root = document.createElement("div");
  root.className = "cmd-quota-root";

  if (!allChannels.length) {
    root.appendChild(emptyResult("Sin canales registrados"));
    return root;
  }

  const withQuota = allChannels.filter(ch => ch.quota?.assigned);
  root.appendChild(resultHeader(
    `${allChannels.length} canal${allChannels.length !== 1 ? "es" : ""} · ${withQuota.length} con cuota asignada`
  ));

  allChannels.forEach(ch => root.appendChild(_buildQuotaCard(ch, api)));

  // Async: cargar uso + bitrates y actualizar barras
  if (api) {
    _fetchQuotaDetails(allChannels, api).then(({ usageByChannel, rateByChannel }) => {
      allChannels.forEach(ch => {
        if (!ch.quota?.assigned || !ch.quota?.limit_bytes) return;
        const block = root.querySelector(`#qu-${ch.channel}`);
        if (!block) return;

        const usage     = usageByChannel[ch.channel];
        const gbPerHour = rateByChannel[ch.channel];
        const limitB    = ch.quota.limit_bytes;

        if (!usage) { block.innerHTML = `<span class="cmd-q-label">Sin datos de uso</span>`; return; }

        const usedB  = usage.used_bytes || 0;
        const freeB  = usage.free_bytes ?? Math.max(0, limitB - usedB);
        const pct    = limitB > 0 ? Math.min(Math.round(usedB / limitB * 100), 100) : 0;
        const barCls = pct >= 90 ? "cmd-q-bar-crit" : pct >= 70 ? "cmd-q-bar-warn" : "cmd-q-bar-ok";

        let timeHtml = "";
        if (gbPerHour) {
          const usedSec = (usedB / 1e9 / gbPerHour) * 3600;
          const freeSec = (freeB / 1e9 / gbPerHour) * 3600;
          timeHtml = `
            <div class="cmd-q-time-grid">
              <div class="cmd-q-time-item">
                <div class="cmd-q-time-label">Grabado</div>
                <div class="cmd-q-time-val">${esc(_fmtDuration(usedSec))}</div>
              </div>
              <div class="cmd-q-time-item">
                <div class="cmd-q-time-label">Disponible</div>
                <div class="cmd-q-time-val cmd-q-free">${esc(_fmtDuration(freeSec))}</div>
              </div>
            </div>`;
        }

        block.innerHTML = `
          <div class="cmd-q-nums-row">
            <span class="cmd-q-used">${esc(_fmtBytes(usedB))}</span>
            <span class="cmd-q-sep">de</span>
            <span>${esc(_fmtBytes(limitB))}</span>
            <span class="cmd-q-pct">${pct}%</span>
          </div>
          <div class="cmd-q-bar-track">
            <div class="cmd-q-bar-fill ${barCls}" style="width:0"></div>
          </div>
          ${timeHtml}
        `;
        const fill = block.querySelector(".cmd-q-bar-fill");
        if (fill) requestAnimationFrame(() => { fill.style.width = pct + "%"; });
      });
    }).catch(() => {});
  }

  return root;
};

RENDERERS["quota.set"]            = okBanner;
RENDERERS["quota.change"]         = okBanner;
RENDERERS["quota.overwrite.set"]  = okBanner;
RENDERERS["quota.overwrite.mabul"]= okBanner;

// ─── audit ───────────────────────────────────────────────────────

RENDERERS["audit.event"] = (data) => {
  const events = data?.events || data?.results || (Array.isArray(data) ? data : []);
  const list = document.createElement("div");
  list.appendChild(resultHeader(`${events.length} evento${events.length !== 1 ? "s" : ""}`));
  const stack = makeStack(list);

  if (!events.length) { list.appendChild(emptyResult("Sin eventos")); return stack.root; }

  events.forEach(ev => {
    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <div class="cmd-row-main">
        <div class="cmd-row-title">${esc(ev.name || ev.event_name || ev.type || "evento")}</div>
        <div class="cmd-row-sub">${esc(ev.timestamp || ev.ts || ev.created_at || "")}</div>
      </div>
      ${badge(ev.module || "", "brand")}
    `;
    row.addEventListener("click", () => stack.push(kvTable(ev), ev.name || "Evento"));
    list.appendChild(row);
  });
  return stack.root;
};

// ─── calc ────────────────────────────────────────────────────────

function _renderCalcResult(d) {
  const root = document.createElement("div");
  root.className = "cmd-calc-root";
  const results = d?.results || [];
  if (!results.length) { root.appendChild(emptyResult("Sin resultados")); return root; }

  const expr = d?.expr || "";
  const parts = expr.split("/");
  // Detect direction: size/time or time/size
  const timeUnits = { s:"segundos", m:"minutos", h:"horas", d:"días" };
  const sizeUnits = { kb:"KB", mb:"MB", gb:"GB", tb:"TB" };
  const rUnit = parts[1]?.replace(/^\d+/,"").toLowerCase();
  const isTime = !!timeUnits[rUnit];

  results.forEach(r => {
    if (r.status === "error") {
      const err = document.createElement("div");
      err.className = "cmd-calc-error";
      err.textContent = `Canal ${r.channel}: ${r.error || "error"}`;
      root.appendChild(err);
      return;
    }

    const val = r.value;
    let display = "";
    if (isTime) {
      // Result is a ratio; interpret as "X gb lasts Y time" or "X time uses Y gb"
      // "Xgb/d" → days that X GB lasts = (gb_per_day) / X  → need inverse: X / (gb_per_day)
      // But calc returns (gb_per_day)/X, so actual days = 1/result (when expr is Xgb/d)
      // Actually from our testing: "41gb/d"=0.99 days, "1gb/h"=1.695 GB/h
      // For size/time: result = GB_per_rUnit / l_qty → days = l_qty / GB_per_rUnit = 1/result
      const days  = 1 / val * (rUnit === "d" ? 1 : rUnit === "h" ? 1/24 : rUnit === "m" ? 1/1440 : 1/86400);
      display = _fmtSeconds(days * 86400);
    } else {
      display = val.toFixed(2) + " " + (sizeUnits[rUnit] || rUnit);
    }

    const card = document.createElement("div");
    card.className = "cmd-calc-card";
    card.innerHTML = `
      <div class="cmd-calc-ch">Canal ${esc(r.channel)}</div>
      <div class="cmd-calc-result">${esc(display)}</div>
      <div class="cmd-calc-expr">${esc(expr)}</div>
    `;
    root.appendChild(card);
  });
  return root;
}

RENDERERS["calc.size.time"] = _renderCalcResult;
RENDERERS["calc.time.size"] = _renderCalcResult;

// ─── performance ─────────────────────────────────────────────────

RENDERERS["performance.add"] = okBanner;

RENDERERS["performance.list"] = (data) => {
  const events = Array.isArray(data) ? data : (data?.events || data?.results || []);
  const list = document.createElement("div");
  list.appendChild(resultHeader(`${events.length} evento${events.length !== 1 ? "s" : ""}`));
  const stack = makeStack(list);

  if (!events.length) { list.appendChild(emptyResult("Sin eventos de performance")); return stack.root; }

  events.forEach(ev => {
    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <div class="cmd-row-main">
        <div class="cmd-row-title">${esc(ev.event || ev.name || "evento")}</div>
        <div class="cmd-row-sub">CH${esc(ev.channel ?? "?")}  ${esc(ev.ts || ev.timestamp || "")}</div>
      </div>
      ${ev.cpu ? badge("CPU " + ev.cpu, "muted") : ""}
    `;
    row.addEventListener("click", () => stack.push(kvTable(ev), ev.event || "Evento"));
    list.appendChild(row);
  });
  return stack.root;
};

RENDERERS["performance.snapshot"] = (data) => {
  const el = document.createElement("div");
  el.className = "cmd-kv-table";
  const metrics = [
    { key: "CPU",    val: data?.cpu,  icon: "🖥" },
    { key: "RAM",    val: data?.ram,  icon: "💾" },
    { key: "Disco",  val: data?.disk, icon: "💿" },
    { key: "Red",    val: data?.net,  icon: "🌐" },
  ];
  metrics.forEach(({ key, val, icon }) => {
    if (val === undefined) return;
    const row = document.createElement("div");
    row.className = "cmd-kv-row";
    row.innerHTML = `<span class="cmd-kv-key">${icon} ${esc(key)}</span><span class="cmd-kv-val">${esc(typeof val === "object" ? JSON.stringify(val) : val)}</span>`;
    el.appendChild(row);
  });
  if (!el.children.length) el.appendChild(kvTable(data));
  return el;
};

// ─── playback ────────────────────────────────────────────────────

RENDERERS["playback.info"] = (data) => {
  const segs = data?.segments || data?.files || (Array.isArray(data) ? data : []);
  const list = document.createElement("div");
  list.appendChild(resultHeader(`${segs.length} segmento${segs.length !== 1 ? "s" : ""}`));
  const stack = makeStack(list);

  if (!segs.length) {
    const meta = kvTable(data);
    list.appendChild(meta);
    return stack.root;
  }

  segs.forEach((seg, i) => {
    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <span class="cmd-ch-badge">#${i+1}</span>
      <div class="cmd-row-main">
        <div class="cmd-row-title">${esc(seg.path || seg.file || seg.name || `segmento ${i+1}`)}</div>
        <div class="cmd-row-sub">${esc(seg.start || seg.from || "")} → ${esc(seg.end || seg.to || "")}</div>
      </div>
      ${badge(seg.size || "", "muted")}
    `;
    row.addEventListener("click", () => stack.push(kvTable(seg), `Segmento #${i+1}`));
    list.appendChild(row);
  });
  return stack.root;
};

RENDERERS["playback.range"] = (d) => { const s = makeStack(kvTable(Array.isArray(d) ? Object.fromEntries(d.map((v,i)=>[i,v])) : d)); return s.root; };

// ─── play ────────────────────────────────────────────────────────

RENDERERS["play.live.ui"] = (data) => {
  const streams = data?.streams || [];
  const list = document.createElement("div");
  list.appendChild(resultHeader(`${streams.length} stream${streams.length !== 1 ? "s" : ""}`));
  const stack = makeStack(list);

  if (!streams.length) {
    list.appendChild(kvTable(data));
    return stack.root;
  }

  streams.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "cmd-result-row clickable";
    row.innerHTML = `
      <span class="cmd-ch-badge">CH${esc(s.channel ?? i+1)}</span>
      <div class="cmd-row-main">
        <div class="cmd-row-title">${esc(s.url || s.stream_url || "stream")}</div>
        <div class="cmd-row-sub">expires_in: ${esc(s.expires_in || data?.expires_in || "??")}s</div>
      </div>
    `;
    row.addEventListener("click", () => stack.push(kvTable(s), `Stream CH${s.channel ?? i+1}`));
    list.appendChild(row);
  });
  return stack.root;
};

// ─── export ──────────────────────────────────────────────────────

RENDERERS["export.txt"] = okBanner;

// ─── system ──────────────────────────────────────────────────────

RENDERERS["system.health"]        = (d) => { const s = makeStack(kvTable(d)); return s.root; };
RENDERERS["system.version"]       = (d) => { const s = makeStack(kvTable(d)); return s.root; };
RENDERERS["system.mode.status"]   = (d) => { const s = makeStack(kvTable(d)); return s.root; };
RENDERERS["system.mode.set"]      = okBanner;
RENDERERS["system.locale.status"] = (d) => { const s = makeStack(kvTable(d)); return s.root; };
RENDERERS["system.locale.set"]    = okBanner;
RENDERERS["system.streams.status"]= (d) => { const s = makeStack(kvTable(d)); return s.root; };

// ─── client ──────────────────────────────────────────────────────

// ─── api server ──────────────────────────────────────────────────

RENDERERS["api.status"] = (d) => {
  const list = document.createElement("div");
  const stateOk = d?.status === "RUNNING" || d?.state === "ACTIVE";
  const healthOk = d?.health?.http_status === 200;

  const banner = document.createElement("div");
  banner.className = stateOk && healthOk ? "cmd-result-ok-banner" : "cmd-result-error";
  banner.textContent = stateOk && healthOk ? "● Servidor activo y saludable" : "⚠ Servidor con problemas";
  list.appendChild(banner);

  list.appendChild(kvTable({
    "Servicio":    d?.service || "—",
    "Estado":      d?.state || "—",
    "PID":         d?.pid || "—",
    "Uptime":      d?.uptime || "—",
    "Iniciado":    d?.active_enter_timestamp || "—",
    "HTTP Health": d?.health?.status || "—",
  }));
  const s = makeStack(list);
  return s.root;
};

RENDERERS["api.logs"] = (d) => {
  const lines = (d?.lines || []).join("\n") || d?.log || "(sin logs)";
  const root = document.createElement("div");
  root.className = "cmd-log-box";
  root.style.cssText = "max-height:360px;overflow-y:auto;";
  root.textContent = lines;
  return root;
};

RENDERERS["api.restart"] = okBanner;
