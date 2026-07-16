const { app, BrowserWindow, ipcMain, shell, screen, Menu, Tray, nativeImage, nativeTheme, Notification } = require("electron");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const { existsSync, readFileSync, readdirSync, statSync } = require("fs");
const { homedir } = require("os");
const { delimiter, join } = require("path");
const { singleFlight } = require("./single-flight");

const execFileAsync = promisify(execFile);
const REQUEST_TIMEOUT_MS = 15_000;
const QUOTA_CACHE_MS = 3 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASES_API_URL = "https://api.github.com/repos/jeurboy/llm-quota-window/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/jeurboy/llm-quota-window/releases";
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
let claudeRetryAt = 0;

function resolveCli(name) {
  const executableNames = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const pathDirectories = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const knownDirectories = [
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.APPDATA && join(process.env.APPDATA, "npm"),
  ].filter(Boolean);
  for (const directory of [...new Set([...pathDirectories, ...knownDirectories])]) {
    for (const executableName of executableNames) {
      const candidate = join(directory, executableName);
      if (existsSync(candidate)) return candidate;
    }
  }
  return name;
}

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

function updateTrayMenu() {
  if (!tray) return;
  const statusItems = latestQuotas.length
    ? latestQuotas.map((provider) => ({ label: quotaMenuLabel(provider), enabled: false }))
    : [{ label: "Quota not checked yet", enabled: false }];
  trayMenu = Menu.buildFromTemplate([
    ...statusItems,
    { type: "separator" },
    { label: mainWindow?.isVisible() ? "Hide dashboard" : "Open dashboard", click: () => mainWindow?.isVisible() ? mainWindow.hide() : showMainWindow() },
    { label: "Refresh quota", click: () => refreshAndBroadcast(true) },
    { label: "Ping Claude/Fable (start 5-hour window)", click: () => pingClaude().catch(() => {}) },
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
        "X-GitHub-Api-Version": "2022-11-28",
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

function commandError(command, error) {
  if (error.code === "ENOENT") {
    return `${command} CLI was not found. Install it and sign in, then refresh.`;
  }
  return error.stderr?.trim() || error.message || `${command} could not be started.`;
}

async function runJson(command, args) {
  try {
    const { stdout } = await execFileAsync(resolveCli(command), args, {
      timeout: REQUEST_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1_000_000,
    });
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(commandError(command, error));
  }
}

function callCodex(method, params = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    let nextId = 1;
    const pending = new Map();
    const processHandle = spawn(resolveCli("codex"), ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      processHandle.kill();
      callback(value);
    };
    const request = (requestMethod, requestParams) => new Promise((requestResolve, requestReject) => {
      const id = nextId++;
      pending.set(id, { resolve: requestResolve, reject: requestReject });
      processHandle.stdin.write(`${JSON.stringify({ id, method: requestMethod, params: requestParams })}\n`);
    });
    const timer = setTimeout(() => finish(reject, new Error("Codex did not respond within 15 seconds.")), REQUEST_TIMEOUT_MS);

    processHandle.on("error", (error) => finish(reject, new Error(commandError("Codex", error))));
    processHandle.stderr.on("data", () => {});
    processHandle.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === undefined) continue;
          const pendingRequest = pending.get(message.id);
          if (!pendingRequest) continue;
          pending.delete(message.id);
          if (message.error) pendingRequest.reject(new Error(message.error.message || "Codex returned an error."));
          else pendingRequest.resolve(message.result);
        } catch {
          // App-server notifications are line-delimited JSON. Ignore malformed diagnostics.
        }
      }
    });

    (async () => {
      try {
        await request("initialize", {
          clientInfo: { name: "Quota Window", title: "Quota Window", version: app.getVersion() },
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        const result = await request(method, params);
        finish(resolve, result);
      } catch (error) {
        finish(reject, error);
      }
    })();
  });
}

function toWindow(window, fallbackName) {
  if (!window) return null;
  return {
    name: fallbackName,
    usedPercent: Number(window.usedPercent ?? 0),
    durationMinutes: window.windowDurationMins ?? null,
    resetsAt: window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : null,
  };
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getCodexQuota() {
  const [result, tokenUsage] = await Promise.all([
    callCodex("account/rateLimits/read"),
    callCodex("account/usage/read"),
  ]);
  const snapshot = result.rateLimits;
  if (!snapshot) throw new Error("Codex is signed out. Run `codex login` and refresh.");
  const dailyBuckets = tokenUsage.dailyUsageBuckets || [];
  const today = localDateKey();
  const todayBucket = dailyBuckets.find((bucket) => bucket.startDate === today) || null;

  return {
    provider: "codex",
    label: "Codex",
    connected: true,
    plan: snapshot.planType || null,
    windows: [
      toWindow(snapshot.primary, "Current window"),
      toWindow(snapshot.secondary, "Secondary window"),
    ].filter(Boolean),
    credits: result.rateLimitResetCredits?.availableCount ?? 0,
    tokenUsage: {
      source: "Account usage",
      lifetimeTokens: tokenUsage.summary?.lifetimeTokens ?? null,
      dayTokens: todayBucket?.tokens ?? 0,
      day: today,
      dayLabel: "today",
      peakDailyTokens: tokenUsage.summary?.peakDailyTokens ?? null,
    },
    updatedAt: new Date().toISOString(),
  };
}

function startOfLocalDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function claudeLocalTokenUsage() {
  const root = join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return null;
  const seenRequests = new Set();
  let tokens = 0;
  const start = startOfLocalDay();
  const paths = [root];

  while (paths.length) {
    const current = paths.pop();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) { paths.push(path); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try {
        if (statSync(path).mtimeMs < start) continue;
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (!line) continue;
          const item = JSON.parse(line);
          if (item.type !== "assistant" || !item.message?.usage || new Date(item.timestamp).getTime() < start) continue;
          const id = item.requestId || item.uuid;
          if (!id || seenRequests.has(id)) continue;
          seenRequests.add(id);
          const usage = item.message.usage;
          tokens += Number(usage.input_tokens || 0)
            + Number(usage.output_tokens || 0)
            + Number(usage.cache_read_input_tokens || 0)
            + Number(usage.cache_creation_input_tokens || 0);
        }
      } catch {
        // A session can be updated while this scan runs. Skip its unreadable line/file.
      }
    }
  }
  return { source: "Claude Code local history", dayTokens: tokens, day: localDateKey(), dayLabel: "today" };
}

function getClaudeCredentials() {
  if (process.platform === "darwin") {
    try {
      const raw = require("child_process").execFileSync(
        "security",
        ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        { encoding: "utf8", windowsHide: true },
      );
      return JSON.parse(raw).claudeAiOauth;
    } catch {
      // Fall through: older Claude Code versions store credentials in a file.
    }
  }

  const candidates = [
    join(homedir(), ".claude", ".credentials.json"),
    join(homedir(), ".claude", "credentials.json"),
    process.env.APPDATA && join(process.env.APPDATA, "Claude", "credentials.json"),
  ].filter(Boolean);
  for (const path of candidates) {
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        const credentials = parsed.claudeAiOauth || parsed.oauth || parsed;
        if (credentials.accessToken) return credentials;
      }
    } catch {
      // Try the next known credential location.
    }
  }
  return null;
}

function toClaudeWindow(item, fallbackName) {
  if (!item) return null;
  return {
    name: item.kind === "session" ? "5-hour session" : fallbackName,
    usedPercent: Number(item.percent ?? item.utilization ?? 0),
    durationMinutes: item.kind === "session" ? 300 : item.kind?.startsWith("weekly") ? 10_080 : null,
    resetsAt: item.resets_at || null,
  };
}

async function getClaudeQuota() {
  if (Date.now() < claudeRetryAt) {
    const remainingSeconds = Math.ceil((claudeRetryAt - Date.now()) / 1_000);
    throw new Error(`Claude usage is temporarily rate limited. Retrying automatically in ${remainingSeconds}s.`);
  }
  const auth = await runJson("claude", ["auth", "status"]);
  if (!auth.loggedIn) throw new Error("Claude Code is signed out. Run `claude auth login` and refresh.");

  const credentials = getClaudeCredentials();
  if (!credentials?.accessToken) {
    throw new Error("Could not read Claude Code's local sign-in. Run `claude auth login` and refresh.");
  }
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") || "", 10);
      const waitSeconds = Number.isFinite(retryAfterSeconds) ? Math.max(15, retryAfterSeconds) : 60;
      claudeRetryAt = Date.now() + (waitSeconds * 1_000);
      throw new Error(`Claude usage is temporarily rate limited. Retrying automatically in ${waitSeconds}s.`);
    }
    throw new Error(response.status === 401
      ? "Claude sign-in expired. Run `claude auth login` and refresh."
      : `Claude usage request failed (${response.status}).`);
  }
  claudeRetryAt = 0;
  const usage = await response.json();
  const limits = Array.isArray(usage.limits) ? usage.limits : [];
  const session = limits.find((item) => item.kind === "session") || usage.five_hour;
  const weekly = limits.find((item) => item.kind === "weekly_all") || usage.seven_day;
  const fable = limits.find((item) =>
    item.kind === "weekly_scoped"
    && item.scope?.model?.display_name?.toLowerCase() === "fable");

  return {
    provider: "claude",
    label: "Claude",
    connected: true,
    plan: auth.subscriptionType || credentials.subscriptionType || null,
    windows: [
      toClaudeWindow(session, "5-hour session"),
      toClaudeWindow(weekly, "Weekly allowance"),
      toClaudeWindow(fable, "Fable weekly allowance"),
    ].filter(Boolean),
    credits: usage.extra_usage?.is_enabled ? usage.extra_usage.remaining_dollars : null,
    tokenUsage: claudeLocalTokenUsage(),
    updatedAt: new Date().toISOString(),
  };
}

async function loadQuotas() {
  const providers = await Promise.allSettled([getClaudeQuota(), getCodexQuota()]);
  latestQuotas = providers.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      provider: index === 0 ? "claude" : "codex",
      label: index === 0 ? "Claude" : "Codex",
      connected: false,
      retrying: /temporarily rate limited/i.test(result.reason?.message || ""),
      windows: [],
      error: result.reason?.message || "Could not load this provider.",
      updatedAt: new Date().toISOString(),
    };
  });
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

async function pingClaudeRequest() {
  try {
    await execFileAsync(resolveCli("claude"), [
      "--safe-mode",
      "--print",
      "Reply only with: pong",
      "--system-prompt",
      "Reply only with the single word pong.",
      "--model",
      "fable",
      "--tools",
      "",
      "--no-session-persistence",
      "--output-format",
      "json",
    ], {
      timeout: 90_000,
      windowsHide: true,
      maxBuffer: 1_000_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return { ok: true, providers: await refreshAndBroadcast(true) };
  } catch (error) {
    throw new Error(commandError("Claude", error));
  }
}

const pingClaude = singleFlight(pingClaudeRequest);

ipcMain.handle("quota:refresh", (_, force = false) => getQuotas(Boolean(force)));
ipcMain.handle("app:openUsage", (_, provider) => shell.openExternal(
  provider === "claude" ? "https://claude.ai/settings/usage" : "https://chatgpt.com/codex/settings/usage",
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
ipcMain.handle("app:getStartOnLogin", () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("app:setStartOnLogin", (_, enabled) => setStartOnLogin(enabled));
ipcMain.handle("app:checkForUpdates", checkForUpdates);
ipcMain.handle("app:openRelease", () => shell.openExternal(updateState.releaseUrl || RELEASES_PAGE_URL));
ipcMain.handle("app:showDashboard", () => showMainWindow());
ipcMain.handle("app:hidePopup", () => popupWindow?.hide());
ipcMain.handle("claude:ping", pingClaude);

app.whenReady().then(() => {
  const loginSettings = app.getLoginItemSettings();
  startOnLoginPreference = loginSettings.openAtLogin;
  createWindow(!loginSettings.wasOpenedAtLogin);
  createTray();
  nativeTheme.on("updated", () => {
    if (themePreference === "system") sendToWindows("app:themeChanged", currentThemeState());
  });
  setInterval(() => refreshAndBroadcast(true), 3 * 60 * 1000);
  setTimeout(checkForUpdates, 2_500);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
  app.on("activate", showMainWindow);
});
app.on("before-quit", () => { isQuitting = true; });
