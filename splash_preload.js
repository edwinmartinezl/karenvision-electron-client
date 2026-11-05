// Archivo: external_clients/karenvision-electron-client/splash_preload.js
// Preload del splash para notificar al proceso principal cuando la intro termina.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("splashLifecycle", {
  introComplete() {
    ipcRenderer.send("splash:intro-complete");
  }
});
