const { app, BrowserWindow, ipcMain, webContents, Menu, clipboard } = require("electron");

const { createAppWindows, handleSplashIntroComplete } = require("./windows/splash-window");
const { registerWindowIpcHandlers } = require("./ipc/window-ipc");
const { registerKvIpcHandlers } = require("./ipc/kv-ipc");
const { touchLastActive } = require("./session/persisted-session");
const { ensurePlaybackProxy } = require("./playback/playback-proxy");

function initMainProcess() {
  registerWindowIpcHandlers();
  registerKvIpcHandlers();
  ensurePlaybackProxy();

  ipcMain.on("splash:intro-complete", handleSplashIntroComplete);

  // Forward ALL renderer console messages — fires before window is shown
  app.on("web-contents-created", (_e, wc) => {
    wc.on("console-message", (_ev, level, message, line, sourceId) => {
      const prefix = ["DBG","INF","WRN","ERR"][level] || "LOG";
      const src = String(sourceId || "").split("/").slice(-2).join("/");
      console.log(`[R:${prefix}] ${message}  @${src}:${line}`);
    });

    // Menú de contexto: permite copiar cualquier texto seleccionado
    wc.on("context-menu", (_ev, params) => {
      const items = [];

      if (params.selectionText && params.selectionText.trim()) {
        items.push({
          label: "Copiar",
          accelerator: "CmdOrCtrl+C",
          click: () => clipboard.writeText(params.selectionText)
        });
        items.push({ type: "separator" });
      }

      items.push({
        label: "Seleccionar todo",
        accelerator: "CmdOrCtrl+A",
        role: "selectAll"
      });

      if (params.isEditable) {
        items.push({ type: "separator" });
        if (params.selectionText) {
          items.push({ label: "Cortar", accelerator: "CmdOrCtrl+X", role: "cut" });
        }
        items.push({ label: "Pegar", accelerator: "CmdOrCtrl+V", role: "paste" });
      }

      if (items.length) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) });
    });
  });

  app.whenReady().then(() => {
    createAppWindows();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createAppWindows();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Marca el momento en que se cierra la app — es lo que cuenta para la
  // ventana de 30 min de inactividad antes de pedir login de nuevo (ver
  // main/session/persisted-session.js). Además, un touch periódico como
  // respaldo por si la app se cierra de golpe (crash, kill) sin disparar
  // before-quit.
  app.on("before-quit", () => touchLastActive());
  setInterval(() => touchLastActive(), 5 * 60 * 1000);
}

module.exports = {
  initMainProcess
};
