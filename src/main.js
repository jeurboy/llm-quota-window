// Quota Window app shell: windows, tray, settings, alerts, updates, IPC, and
// the orchestration layer over the per-provider modules in src/providers/.
const { app, BrowserWindow, ipcMain, shell, screen, Menu, Tray, nativeImage, nativeTheme, Notification } = require("electron");
const { readFileSync, writeFileSync } = require("fs");
const { join } = require("path");
const { singleFlight } = require("./single-flight");
const { commandError } = require("./cli");
const { subscribe } = require("./bus");
const { quotaProviders, providerUsagePages, kimi } = require("./providers");
const {
  REQUEST_TIMEOUT_MS,
  QUOTA_CACHE_MS,
  AUTO_REFRESH_INTERVAL_MS,
  UPDATE_CHECK_INTERVAL_MS,
  PING_SETTLE_DELAY_MS,
  AUTO_PING_INTERVALS_MINUTES,
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
  DONATE_URL,
  GITHUB_API_VERSION,
  SETTINGS_FILE_NAME,
  CODEX_USAGE_PAGE_URL,
} = require("./config");

let mainWindow = null;
let popupWindow = null;
let tray = null;
let trayMenu = null;
let isQuitting = false;
let latestQuotas = [];
let lastQuotaRefreshAt = 0;
let alwaysOnTopPreference = false;
let themePreference = "system";
let startOnLoginPreference = false;
let updateState = { status: "idle", currentVersion: null, latestVersion: null, releaseUrl: RELEASES_PAGE_URL };
const quotaAlertState = new Map();
let autoPingIntervalMinutes = 0;
let autoPingTimer = null;
let disabledProviders = new Set();

function createWindow(show = true) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 660;
  const height = 460;
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 540,
    minHeight: 360,
    x: workArea.x + workArea.width - width - 18,
    y: workArea.y + workArea.height - height - 18,
    show,
    resizable: true,
    title: "Quota Window",
    backgroundColor: "#0b1020",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(join(__dirname, "index.html"));
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideMainWindow();
  });
  mainWindow.on("minimize", (event) => {
    event.preventDefault();
    hideMainWindow();
  });
  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  updateTrayMenu();
}

function showMainWindow() {
  popupWindow?.hide();
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendToWindows(channel, payload) {
  for (const window of [mainWindow, popupWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isLoading()) window.webContents.send(channel, payload);
  }
}

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 360,
    height: 430,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#00000000",
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popupWindow.loadFile(join(__dirname, "popup.html"));
  popupWindow.on("blur", () => popupWindow?.hide());
  popupWindow.webContents.on("did-finish-load", () => {
    if (latestQuotas.length) popupWindow.webContents.send("quota:updated", latestQuotas);
    popupWindow.webContents.send("app:themeChanged", currentThemeState());
    popupWindow.webContents.send("app:updateStateChanged", updateState);
  });
}

function showQuotaPopup() {
  if (!popupWindow || popupWindow.isDestroyed()) createPopupWindow();
  hideMainWindow();
  const trayBounds = tray.getBounds();
  const popupBounds = popupWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const workArea = display.workArea;
  const x = Math.max(workArea.x + 8, Math.min(
    Math.round(trayBounds.x + (trayBounds.width / 2) - (popupBounds.width / 2)),
    workArea.x + workArea.width - popupBounds.width - 8,
  ));
  const isBottomTray = trayBounds.y > workArea.y + (workArea.height / 2);
  const y = isBottomTray
    ? trayBounds.y - popupBounds.height - 8
    : trayBounds.y + trayBounds.height + 8;
  popupWindow.setPosition(x, y, false);
  popupWindow.show();
  popupWindow.focus();
}

function togglePopup() {
  if (!popupWindow || popupWindow.isDestroyed()) createPopupWindow();
  if (popupWindow.isVisible()) {
    popupWindow.hide();
    return;
  }
  showQuotaPopup();
}

function quotaMenuLabel(provider) {
  if (provider.retrying) return `${provider.label}: retrying soon`;
  if (!provider.connected) return `${provider.label}: action needed`;
  const primaryWindow = provider.windows?.[0];
  if (!primaryWindow) return `${provider.label}: connected`;
  return `${provider.label}: ${Math.max(0, Math.round(100 - primaryWindow.usedPercent))}% left`;
}

function quotaLimitType(window) {
  if (window.durationMinutes === 300 || /5-hour|session/i.test(window.name)) return "day";
  if ((window.durationMinutes || 0) >= 1_440 || /week|7-day/i.test(window.name)) return "week";
  return "window";
}

function sendQuotaAlert(title, body) {
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body, silent: false });
    notification.on("click", () => showQuotaPopup());
    notification.show();
  }
  showQuotaPopup();
}

function checkQuotaAlerts(providers) {
  for (const provider of providers) {
    if (!provider.connected) continue;
    for (const window of provider.windows || []) {
      const remaining = Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));
      const key = `${provider.provider}:${window.name}:${window.resetsAt || "unknown"}`;
      const previous = quotaAlertState.get(key);
      quotaAlertState.set(key, remaining);
      if (previous === undefined || remaining >= previous) continue;

      const limitType = quotaLimitType(window);
      const critical = (limitType === "day" && previous >= 20 && remaining < 20)
        || (limitType === "week" && previous >= 10 && remaining < 10);
      const crossedTenPercent = Math.ceil(previous / 10) > Math.ceil(remaining / 10);
      if (!critical && !crossedTenPercent) continue;

      const limitLabel = limitType === "day" ? "Daily/session limit" : limitType === "week" ? "Weekly limit" : "Quota window";
      const urgency = critical ? "Low quota warning" : "Quota update";
      sendQuotaAlert(
        `${urgency}: ${provider.label}`,
        `${limitLabel} · ${window.name} has ${remaining}% left.`,
      );
    }
  }
}

function setAlwaysOnTop(enabled) {
  alwaysOnTopPreference = Boolean(enabled);
  mainWindow?.setAlwaysOnTop(alwaysOnTopPreference, "floating");
  sendToWindows("app:alwaysOnTopChanged", alwaysOnTopPreference);
  updateTrayMenu();
  return mainWindow?.isAlwaysOnTop() ?? alwaysOnTopPreference;
}

function currentThemeState() {
  return {
    preference: themePreference,
    effective: nativeTheme.shouldUseDarkColors ? "dark" : "light",
  };
}

function setTheme(theme) {
  themePreference = ["system", "light", "dark"].includes(theme) ? theme : "system";
  nativeTheme.themeSource = themePreference;
  const state = currentThemeState();
  sendToWindows("app:themeChanged", state);
  updateTrayMenu();
  return state;
}

function setStartOnLogin(enabled) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: true,
  });
  startOnLoginPreference = app.getLoginItemSettings().openAtLogin;
  sendToWindows("app:startOnLoginChanged", startOnLoginPreference);
  updateTrayMenu();
  return startOnLoginPreference;
}

function autoPingSettingsPath() {
  return join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function loadSettings() {
  try {
    const settings = JSON.parse(readFileSync(autoPingSettingsPath(), "utf8"));
    return {
      autoPingIntervalMinutes: AUTO_PING_INTERVALS_MINUTES.includes(settings.autoPingIntervalMinutes)
        ? settings.autoPingIntervalMinutes
        : 0,
      disabledProviders: Array.isArray(settings.disabledProviders) ? settings.disabledProviders : [],
    };
  } catch {
    return { autoPingIntervalMinutes: 0, disabledProviders: [] };
  }
}

function saveSettings() {
  try {
    writeFileSync(autoPingSettingsPath(), JSON.stringify({
      autoPingIntervalMinutes,
      disabledProviders: [...disabledProviders],
    }, null, 2));
  } catch {
    // Preferences are optional; changes still apply for this app session.
  }
}

function setAutoPingInterval(minutes, { persist = true } = {}) {
  autoPingIntervalMinutes = AUTO_PING_INTERVALS_MINUTES.includes(minutes) ? minutes : 0;
  if (autoPingTimer) clearInterval(autoPingTimer);
  autoPingTimer = autoPingIntervalMinutes
    ? setInterval(() => pingAllProviders().catch(() => {}), autoPingIntervalMinutes * 60 * 1000)
    : null;
  if (persist) saveSettings();
  updateTrayMenu();
  return autoPingIntervalMinutes;
}

function providerEnabled(provider) {
  return !disabledProviders.has(provider);
}

async function setProviderEnabled(provider, enabled) {
  if (!quotaProviders.some((entry) => entry.provider === provider)) return providerEnabled(provider);
  if (enabled) disabledProviders.delete(provider);
  else {
    disabledProviders.add(provider);
    latestQuotas = latestQuotas.filter((entry) => entry.provider !== provider);
    for (const key of quotaAlertState.keys()) {
      if (key.startsWith(`${provider}:`)) quotaAlertState.delete(key);
    }
  }
  saveSettings();
  updateTrayMenu();
  const providers = await refreshAndBroadcast(true);
  sendToWindows("app:providerSettingsChanged", providerSettings());
  return { enabled: providerEnabled(provider), providers };
}

function providerSettings() {
  return quotaProviders.map(({ provider, label }) => ({ provider, label, enabled: providerEnabled(provider) }));
}

function showProviderMenu(window) {
  const menu = Menu.buildFromTemplate(quotaProviders.map(({ provider, label }) => ({
    label,
    type: "checkbox",
    checked: providerEnabled(provider),
    click: (item) => setProviderEnabled(provider, item.checked).catch(() => {}),
  })));
  menu.popup({ window });
}

function updateTrayMenu() {
  if (!tray) return;
  const statusItems = latestQuotas.length
    ? latestQuotas.map((provider) => ({ label: quotaMenuLabel(provider), enabled: false }))
    : [{ label: lastQuotaRefreshAt ? "No provider accounts found on this device" : "Quota not checked yet", enabled: false }];
  trayMenu = Menu.buildFromTemplate([
    ...statusItems,
    { type: "separator" },
    { label: mainWindow?.isVisible() ? "Hide dashboard" : "Open dashboard", click: () => mainWindow?.isVisible() ? mainWindow.hide() : showMainWindow() },
    { label: "Refresh quota", click: () => refreshAndBroadcast(true) },
    { label: "Ping all connected providers (start usage windows)", click: () => pingAllProviders().catch(() => {}) },
    {
      label: "Auto Ping All Providers",
      submenu: [
        { label: "Off", type: "radio", checked: autoPingIntervalMinutes === 0, click: () => setAutoPingInterval(0) },
        { label: "Every 30 minutes", type: "radio", checked: autoPingIntervalMinutes === 30, click: () => setAutoPingInterval(30) },
        { label: "Every 1 hour", type: "radio", checked: autoPingIntervalMinutes === 60, click: () => setAutoPingInterval(60) },
        { label: "Every 2 hours", type: "radio", checked: autoPingIntervalMinutes === 120, click: () => setAutoPingInterval(120) },
      ],
    },
    {
      label: "Visible providers",
      submenu: quotaProviders.map(({ provider, label }) => ({
        label,
        type: "checkbox",
        checked: providerEnabled(provider),
        click: (item) => setProviderEnabled(provider, item.checked).catch(() => {}),
      })),
    },
    { label: "Always on top", type: "checkbox", checked: alwaysOnTopPreference, click: (item) => setAlwaysOnTop(item.checked) },
    { label: "Start on login", type: "checkbox", checked: startOnLoginPreference, click: (item) => setStartOnLogin(item.checked) },
    {
      label: "Theme",
      submenu: [
        { label: "Auto (System)", type: "radio", checked: themePreference === "system", click: () => setTheme("system") },
        { label: "Light", type: "radio", checked: themePreference === "light", click: () => setTheme("light") },
        { label: "Dark", type: "radio", checked: themePreference === "dark", click: () => setTheme("dark") },
      ],
    },
    updateTrayItem(),
    { type: "separator" },
    { label: "☕ Support development", click: () => shell.openExternal(DONATE_URL) },
    { label: "Quit Quota Window", click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip(latestQuotas.length ? latestQuotas.map(quotaMenuLabel).join(" · ") : "Quota Window");
}

function normalizeVersion(version) {
  return String(version || "0.0.0").replace(/^v/i, "").split("-")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(candidate, current) {
  const candidateParts = normalizeVersion(candidate);
  const currentParts = normalizeVersion(current);
  const length = Math.max(candidateParts.length, currentParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (candidateParts[index] || 0) - (currentParts[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function updateTrayItem() {
  if (updateState.status === "checking") return { label: "Checking for updates…", enabled: false };
  if (updateState.status === "available") {
    return { label: `Update available: v${updateState.latestVersion}`, click: () => shell.openExternal(updateState.releaseUrl) };
  }
  if (updateState.status === "no-releases") return { label: "No GitHub releases yet", click: () => shell.openExternal(RELEASES_PAGE_URL) };
  if (updateState.status === "up-to-date") return { label: `Up to date · v${updateState.currentVersion}`, click: () => checkForUpdates(true) };
  return { label: "Check for updates", click: () => checkForUpdates(true) };
}

function broadcastUpdateState() {
  sendToWindows("app:updateStateChanged", updateState);
  updateTrayMenu();
}

async function checkForUpdates() {
  updateState = { ...updateState, status: "checking", currentVersion: app.getVersion(), error: null };
  broadcastUpdateState();
  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Quota-Window/${app.getVersion()}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) {
      updateState = { ...updateState, status: "no-releases", latestVersion: null, releaseUrl: RELEASES_PAGE_URL };
    } else if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    } else {
      const release = await response.json();
      const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
      updateState = {
        ...updateState,
        status: isNewerVersion(latestVersion, app.getVersion()) ? "available" : "up-to-date",
        latestVersion,
        releaseUrl: release.html_url || RELEASES_PAGE_URL,
      };
    }
  } catch (error) {
    updateState = { ...updateState, status: "error", error: error.message || "Update check failed" };
  }
  broadcastUpdateState();
  return updateState;
}

function createTray() {
  const iconPath = process.platform === "darwin"
    ? join(__dirname, "..", "assets", "trayTemplate.png")
    : join(__dirname, "..", "assets", "app-icon.png");
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createFromPath(join(__dirname, "..", "assets", "app-icon.png"));
  if (process.platform !== "darwin") icon = icon.resize({ width: 20, height: 20 });
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  createPopupWindow();
  tray.on("click", togglePopup);
  tray.on("right-click", () => tray.popUpContextMenu(trayMenu));
  updateTrayMenu();
}

async function loadQuotas() {
  const enabledProviders = quotaProviders.filter((entry) => providerEnabled(entry.provider));
  const providers = await Promise.allSettled(enabledProviders.map((entry) => entry.load()));
  latestQuotas = providers.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    if (result.reason?.notDetected) return null;
    return {
      provider: enabledProviders[index].provider,
      label: enabledProviders[index].label,
      connected: false,
      retrying: /temporarily rate limited/i.test(result.reason?.message || ""),
      windows: [],
      error: result.reason?.message || "Could not load this provider.",
      updatedAt: new Date().toISOString(),
    };
  }).filter((provider) => provider && providerEnabled(provider.provider));
  lastQuotaRefreshAt = Date.now();
  updateTrayMenu();
  return latestQuotas;
}

const refreshQuotas = singleFlight(loadQuotas);

async function getQuotas(force = false) {
  if (!force && latestQuotas.length && Date.now() - lastQuotaRefreshAt < QUOTA_CACHE_MS) return latestQuotas;
  return refreshQuotas();
}

async function refreshAndBroadcast(force = false) {
  const providers = await getQuotas(force);
  sendToWindows("quota:updated", providers);
  checkQuotaAlerts(providers);
  return providers;
}

async function pingAllProvidersRequest() {
  const quotas = await getQuotas();
  const connected = new Set(quotas.filter((entry) => entry.connected).map((entry) => entry.provider));
  const targets = quotaProviders.filter((entry) => entry.ping && providerEnabled(entry.provider) && connected.has(entry.provider));
  if (!targets.length) throw new Error("No connected providers to ping. Sign in to a CLI and refresh.");

  const outcomes = await Promise.allSettled(targets.map((entry) => entry.ping()));
  const results = targets.map((entry, index) => ({
    provider: entry.provider,
    label: entry.label,
    ok: outcomes[index].status === "fulfilled",
    error: outcomes[index].status === "rejected" ? commandError(entry.label, outcomes[index].reason) : null,
  }));
  const failed = results.filter((result) => !result.ok);
  if (failed.length === results.length) {
    throw new Error(failed.map((result) => `${result.label}: ${result.error}`).join(" · "));
  }
  await new Promise((resolve) => setTimeout(resolve, PING_SETTLE_DELAY_MS));
  return { ok: !failed.length, results, providers: await refreshAndBroadcast(true) };
}

const pingAllProviders = singleFlight(pingAllProvidersRequest);

// Provider modules publish lifecycle events through the bus instead of
// depending on this file directly.
subscribe("kimi:webLoginChanged", (state) => sendToWindows("kimi:webLoginChanged", state));
subscribe("kimi:webSessionChanged", () => { refreshAndBroadcast(true).catch(() => {}); });

ipcMain.handle("quota:refresh", (_, force = false) => getQuotas(Boolean(force)));
ipcMain.handle("app:openUsage", (_, provider) => shell.openExternal(
  providerUsagePages[provider] || CODEX_USAGE_PAGE_URL,
));
ipcMain.on("app:minimize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window === mainWindow) hideMainWindow();
  else window?.hide();
});
ipcMain.handle("app:setAlwaysOnTop", (event, enabled) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  return setAlwaysOnTop(enabled);
});
ipcMain.handle("app:setTheme", (_, theme) => setTheme(theme));
ipcMain.handle("app:getVersion", () => app.getVersion());
ipcMain.handle("app:getStartOnLogin", () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("app:setStartOnLogin", (_, enabled) => setStartOnLogin(enabled));
ipcMain.handle("app:checkForUpdates", checkForUpdates);
ipcMain.handle("app:openRelease", () => shell.openExternal(updateState.releaseUrl || RELEASES_PAGE_URL));
ipcMain.handle("app:openDonate", () => shell.openExternal(DONATE_URL));
ipcMain.handle("app:showDashboard", () => showMainWindow());
ipcMain.handle("app:hidePopup", () => popupWindow?.hide());
ipcMain.handle("app:getProviderSettings", () => providerSettings());
ipcMain.handle("app:setProviderEnabled", (_, provider, enabled) => setProviderEnabled(provider, Boolean(enabled)));
ipcMain.handle("kimi:startWebLogin", () => kimi.startWebLogin());
ipcMain.handle("kimi:cancelWebLogin", () => kimi.stopWebLogin());
ipcMain.handle("kimi:signOutWeb", async () => {
  await kimi.signOutWeb();
  return refreshAndBroadcast(true);
});
ipcMain.on("app:showProviderMenu", (event) => showProviderMenu(BrowserWindow.fromWebContents(event.sender)));
ipcMain.on("popup:fitHeight", (event, height) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window !== popupWindow || window.isDestroyed()) return;
  const target = Math.max(280, Math.min(640, Math.ceil(Number(height) || 0)));
  if (target && Math.abs(window.getContentBounds().height - target) > 2) window.setContentSize(360, target);
});
ipcMain.handle("provider:pingAll", () => pingAllProviders());

app.whenReady().then(() => {
  const loginSettings = app.getLoginItemSettings();
  startOnLoginPreference = loginSettings.openAtLogin;
  createWindow(!loginSettings.wasOpenedAtLogin);
  createTray();
  const settings = loadSettings();
  disabledProviders = new Set(settings.disabledProviders.filter((provider) => quotaProviders.some((entry) => entry.provider === provider)));
  setAutoPingInterval(settings.autoPingIntervalMinutes, { persist: false });
  nativeTheme.on("updated", () => {
    if (themePreference === "system") sendToWindows("app:themeChanged", currentThemeState());
  });
  setInterval(() => refreshAndBroadcast(true), AUTO_REFRESH_INTERVAL_MS);
  setTimeout(checkForUpdates, 2_500);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
  app.on("activate", showMainWindow);
});
app.on("before-quit", () => { isQuitting = true; });
