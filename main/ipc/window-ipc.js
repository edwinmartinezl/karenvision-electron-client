const { ipcMain, BrowserWindow } = require("electron");

function registerWindowIpcHandlers() {
  ipcMain.handle("window:minimize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.minimize();
    }
  });

  ipcMain.handle("window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    if (win.isMaximized()) {
      win.unmaximize();
      return;
    }
    win.maximize();
  });

  ipcMain.handle("window:get-state", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { maximized: false, fullscreen: false };
    }
    return {
      maximized: typeof win.isMaximized === "function" ? win.isMaximized() : false,
      fullscreen: typeof win.isFullScreen === "function" ? win.isFullScreen() : false
    };
  });

  ipcMain.handle("window:close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.close();
    }
  });
}

module.exports = {
  registerWindowIpcHandlers
};
