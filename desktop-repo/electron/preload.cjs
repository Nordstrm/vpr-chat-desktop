// Preload — exposes a tiny, safe surface to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vprDesktop", {
  isDesktop: true,
  platform: process.platform,
  // Window controls
  minimize: () => ipcRenderer.invoke("vpr:minimize"),
  maximizeToggle: () => ipcRenderer.invoke("vpr:maximize-toggle"),
  close: () => ipcRenderer.invoke("vpr:close"),
  isMaximized: () => ipcRenderer.invoke("vpr:is-maximized"),
  onWindowState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on("vpr:window-state", handler);
    return () => ipcRenderer.removeListener("vpr:window-state", handler);
  },
  // Autostart
  getAutostart: () => ipcRenderer.invoke("vpr:get-autostart"),
  setAutostart: (enabled) => ipcRenderer.invoke("vpr:set-autostart", enabled),
  // Remember Me credentials (encrypted via safeStorage)
  saveCredentials: (payload) => ipcRenderer.invoke("vpr:save-credentials", payload),
  loadCredentials: () => ipcRenderer.invoke("vpr:load-credentials"),
  clearCredentials: () => ipcRenderer.invoke("vpr:clear-credentials"),
  // Manual updater
  getAppVersion: () => ipcRenderer.invoke("vpr:get-app-version"),
  updaterGetState: () => ipcRenderer.invoke("vpr:updater-get-state"),
  updaterCheck: () => ipcRenderer.invoke("vpr:updater-check"),
  updaterDownload: () => ipcRenderer.invoke("vpr:updater-download"),
  updaterInstall: () => ipcRenderer.invoke("vpr:updater-install"),
  onUpdaterState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on("vpr:updater-state", handler);
    return () => ipcRenderer.removeListener("vpr:updater-state", handler);
  },
  // Screen-share picker
  getScreenSources: () => ipcRenderer.invoke("vpr:get-screen-sources"),
  setScreenSource: (sourceId) => ipcRenderer.invoke("vpr:set-screen-source", sourceId),
});
