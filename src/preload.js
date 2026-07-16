const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quotaWindow", {
  refresh: (force = false) => ipcRenderer.invoke("quota:refresh", force),
  openUsage: (provider) => ipcRenderer.invoke("app:openUsage", provider),
  minimize: () => ipcRenderer.send("app:minimize"),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("app:setAlwaysOnTop", enabled),
  setTheme: (theme) => ipcRenderer.invoke("app:setTheme", theme),
  getStartOnLogin: () => ipcRenderer.invoke("app:getStartOnLogin"),
  setStartOnLogin: (enabled) => ipcRenderer.invoke("app:setStartOnLogin", enabled),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  openRelease: () => ipcRenderer.invoke("app:openRelease"),
  showDashboard: () => ipcRenderer.invoke("app:showDashboard"),
  hidePopup: () => ipcRenderer.invoke("app:hidePopup"),
  pingClaude: () => ipcRenderer.invoke("claude:ping"),
  onRefreshRequested: (callback) => ipcRenderer.on("quota:refreshRequested", callback),
  onQuotaUpdated: (callback) => ipcRenderer.on("quota:updated", (_, providers) => callback(providers)),
  onAlwaysOnTopChanged: (callback) => ipcRenderer.on("app:alwaysOnTopChanged", (_, enabled) => callback(enabled)),
  onThemeChanged: (callback) => ipcRenderer.on("app:themeChanged", (_, theme) => callback(theme)),
  onStartOnLoginChanged: (callback) => ipcRenderer.on("app:startOnLoginChanged", (_, enabled) => callback(enabled)),
  onUpdateStateChanged: (callback) => ipcRenderer.on("app:updateStateChanged", (_, state) => callback(state)),
});
