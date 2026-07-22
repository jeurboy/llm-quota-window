const { app, BrowserWindow, ipcMain, shell, screen, Menu, Tray, nativeImage, nativeTheme, Notification } = require("electron");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } = require("fs");
const { delimiter, join } = require("path");
const { singleFlight } = require("./single-flight");
const { selectCodexDailyUsageBucket } = require("./codex-usage");
const { parseKimiUsagePayload } = require("./kimi-usage");
const { extractCursorSession, parseCursorUsageSummary } = require("./cursor-usage");
const { parseGoogleQuotaBuckets, parseAntigravityModels, googlePlanLabel, googleProjectId } = require("./google-usage");
const { extractCopilotToken, parseCopilotUsage } = require("./copilot-usage");
const {
  REQUEST_TIMEOUT_MS,
  QUOTA_CACHE_MS,
  AUTO_REFRESH_INTERVAL_MS,
  UPDATE_CHECK_INTERVAL_MS,
  PING_TIMEOUT_MS,
  PING_SETTLE_DELAY_MS,
  PING_PROMPT,
  AUTO_PING_INTERVALS_MINUTES,
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
  GITHUB_API_VERSION,
  SETTINGS_FILE_NAME,
  cliKnownDirectories,
  CLAUDE_API_VERSION,
  CLAUDE_USAGE_URL,
  CLAUDE_USAGE_PAGE_URL,
  CLAUDE_PING_MODEL,
  CLAUDE_PROJECTS_ROOT,
  claudeCredentialPaths,
  CODEX_USAGE_PAGE_URL,
  KIMI_CLIENT_ID,
  KIMI_TOKEN_URL,
  KIMI_USAGE_URL,
  KIMI_USAGE_PAGE_URL,
  kimiCredentialsPath,
  CURSOR_USAGE_SUMMARY_URL,
  CURSOR_USAGE_PAGE_URL,
  cursorStateDbPath,
  GEMINI_OAUTH_CLIENT_ID,
  GEMINI_OAUTH_CLIENT_SECRET,
  GOOGLE_TOKEN_URL,
  CLOUD_CODE_LOAD_URL,
  CLOUD_CODE_QUOTA_URL,
  CLOUD_CODE_MODELS_URL,
  GEMINI_USAGE_PAGE_URL,
  ANTIGRAVITY_USAGE_PAGE_URL,
  geminiCredentialsPath,
  COPILOT_USAGE_URL,
  COPILOT_USAGE_PAGE_URL,
  COPILOT_API_VERSION,
  COPILOT_EDITOR_VERSION,
  COPILOT_PLUGIN_VERSION,
  COPILOT_USER_AGENT,
  copilotConfigDirectories,
} = require("./config");

const execFileAsync = promisify(execFile);
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
let autoPingIntervalMinutes = 0;
let autoPingTimer = null;

function resolveCli(name) {
  const executableNames = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const pathDirectories = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const directory of [...new Set([...pathDirectories, ...cliKnownDirectories()])]) {
    for (const executableName of executableNames) {
      const candidate = join(directory, executableName);
      if (existsSync(candidate)) return candidate;
    }
  }
  return name;
}

function isWindowsCommandScript(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

// spawn's shell:true mode on Windows joins the command and args into one string
// without quoting, so cmd.exe splits on any space in the path (e.g. "C:\Program
// Files\...") or in an argument. Quote anything that needs it before that join.
function quoteForWindowsShell(value) {
  const stringValue = String(value);
  if (stringValue !== "" && !/[\s"^&|<>()%!]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function runCli(command, args, { timeout: timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const executable = resolveCli(command);
  const options = {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1_000_000,
  };
  if (!isWindowsCommandScript(executable)) return execFileAsync(executable, args, options);

  // npm installs Windows CLIs as .cmd files. Node cannot execFile those wrappers,
  // so run them through cmd.exe while preserving their stdout for JSON responses.
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const processHandle = spawn(
      quoteForWindowsShell(executable),
      args.map(quoteForWindowsShell),
      { shell: true, windowsHide: true },
    );
    const timeout = setTimeout(() => {
      processHandle.kill();
      const error = new Error(`${command} timed out.`);
      error.stderr = stderr;
      reject(error);
    }, timeoutMs);

    processHandle.stdout.on("data", (chunk) => { stdout += chunk; });
    processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
    processHandle.on("error", (error) => {
      clearTimeout(timeout);
      error.stderr = stderr;
      reject(error);
    });
    processHandle.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(`${command} exited with code ${code}.`);
      error.code = code;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function spawnCli(command, args, options = {}) {
  const executable = resolveCli(command);
  const useShell = isWindowsCommandScript(executable);
  return spawn(
    useShell ? quoteForWindowsShell(executable) : executable,
    useShell ? args.map(quoteForWindowsShell) : args,
    {
      ...options,
      shell: useShell,
      windowsHide: true,
    },
  );
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

function autoPingSettingsPath() {
  return join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function loadAutoPingInterval() {
  try {
    const { autoPingIntervalMinutes: savedInterval } = JSON.parse(readFileSync(autoPingSettingsPath(), "utf8"));
    return AUTO_PING_INTERVALS_MINUTES.includes(savedInterval) ? savedInterval : 0;
  } catch {
    return 0;
  }
}

function setAutoPingInterval(minutes) {
  autoPingIntervalMinutes = AUTO_PING_INTERVALS_MINUTES.includes(minutes) ? minutes : 0;
  if (autoPingTimer) clearInterval(autoPingTimer);
  autoPingTimer = autoPingIntervalMinutes
    ? setInterval(() => pingAllProviders().catch(() => {}), autoPingIntervalMinutes * 60 * 1000)
    : null;
  try {
    writeFileSync(autoPingSettingsPath(), JSON.stringify({ autoPingIntervalMinutes }, null, 2));
  } catch {
    // The preference is optional; automatic pinging still works for this app session.
  }
  updateTrayMenu();
  return autoPingIntervalMinutes;
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

// resolveCli returns the bare name only when the executable exists nowhere on
// PATH or in the known install directories.
function cliInstalled(name) {
  return resolveCli(name) !== name;
}

// Providers that are absent from this device entirely are hidden from every
// surface instead of shown as "action needed".
function notDetectedError(message) {
  const error = new Error(message);
  error.notDetected = true;
  return error;
}

function commandError(command, error) {
  if (error.code === "ENOENT") {
    return `${command} CLI was not found. Install it and sign in, then refresh.`;
  }
  return error.stderr?.trim() || error.message || `${command} could not be started.`;
}

async function runJson(command, args) {
  try {
    const { stdout } = await runCli(command, args);
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
    const processHandle = spawnCli("codex", ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
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
  if (!cliInstalled("codex")) throw notDetectedError("Codex CLI is not installed on this device.");
  const [result, tokenUsage] = await Promise.all([
    callCodex("account/rateLimits/read"),
    callCodex("account/usage/read"),
  ]);
  const snapshot = result.rateLimits;
  if (!snapshot) throw new Error("Codex is signed out. Run `codex login` and refresh.");
  const dailyBuckets = tokenUsage.dailyUsageBuckets || [];
  const today = localDateKey();
  const { bucket: dailyBucket, isToday } = selectCodexDailyUsageBucket(dailyBuckets, today);

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
      dayTokens: dailyBucket?.tokens ?? 0,
      day: dailyBucket?.startDate || today,
      dayLabel: isToday ? "today" : dailyBucket ? `latest · ${dailyBucket.startDate}` : "today",
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
  const root = CLAUDE_PROJECTS_ROOT;
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

  for (const path of claudeCredentialPaths()) {
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
  if (!cliInstalled("claude")) throw notDetectedError("Claude Code CLI is not installed on this device.");
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
  const response = await fetch(CLAUDE_USAGE_URL, {
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "anthropic-version": CLAUDE_API_VERSION },
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

function readKimiCredentials() {
  try {
    const credentials = JSON.parse(readFileSync(kimiCredentialsPath(), "utf8"));
    if (credentials?.access_token) return credentials;
  } catch {
    // Missing or unreadable credentials are reported as signed out below.
  }
  return null;
}

const KIMI_SIGN_IN_MESSAGE = "Kimi Code is signed out. Run `/login` in the Kimi Code CLI and refresh.";

async function refreshKimiCredentials(credentials) {
  if (!KIMI_CLIENT_ID) {
    throw new Error("Kimi token expired. Use the Kimi Code CLI once to refresh it (or set KIMI_CLIENT_ID).");
  }
  if (!credentials.refresh_token) throw new Error(KIMI_SIGN_IN_MESSAGE);
  const response = await fetch(KIMI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: KIMI_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(
      response.status === 401 || response.status === 403 || data.error === "invalid_grant"
        ? KIMI_SIGN_IN_MESSAGE
        : `Kimi token refresh failed (${response.status}).`,
    );
  }
  const expiresIn = Number(data.expires_in ?? credentials.expires_in ?? 900);
  const refreshed = {
    ...credentials,
    access_token: data.access_token,
    refresh_token: data.refresh_token || credentials.refresh_token,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1_000) + expiresIn,
  };
  try {
    const path = kimiCredentialsPath();
    const temporaryPath = `${path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(refreshed, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, path);
  } catch {
    // The refreshed token still works for this session even if it cannot be persisted.
  }
  return refreshed;
}

async function getKimiCredentials() {
  const credentials = readKimiCredentials();
  if (!credentials) throw new Error(KIMI_SIGN_IN_MESSAGE);
  if (Number(credentials.expires_at || 0) - 60 > Date.now() / 1_000) return credentials;
  return refreshKimiCredentials(credentials);
}

async function getKimiQuota() {
  if (!readKimiCredentials() && !cliInstalled("kimi")) {
    throw notDetectedError("Kimi Code is not installed on this device.");
  }
  const credentials = await getKimiCredentials();
  const response = await fetch(KIMI_USAGE_URL, {
    headers: { Authorization: `Bearer ${credentials.access_token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? KIMI_SIGN_IN_MESSAGE : `Kimi usage request failed (${response.status}).`);
  }
  const { plan, windows } = parseKimiUsagePayload(await response.json());
  return {
    provider: "kimi",
    label: "Kimi",
    connected: true,
    plan,
    windows,
    updatedAt: new Date().toISOString(),
  };
}

const CURSOR_SIGN_IN_MESSAGE = "Cursor is not signed in on this device. Open Cursor, sign in, and refresh.";

function getCursorSession() {
  const path = cursorStateDbPath();
  if (!path || !existsSync(path)) return null;
  const buffers = [];
  try {
    buffers.push(readFileSync(path));
    // A running Cursor may hold the freshest token in the WAL, not the main file.
    if (existsSync(`${path}-wal`)) buffers.push(readFileSync(`${path}-wal`));
  } catch {
    // An unreadable store is reported as signed out below.
  }
  return extractCursorSession(buffers);
}

async function getCursorQuota() {
  const session = getCursorSession();
  if (!session) throw notDetectedError(CURSOR_SIGN_IN_MESSAGE);
  const response = await fetch(CURSOR_USAGE_SUMMARY_URL, {
    headers: {
      Accept: "application/json",
      Cookie: `WorkosCursorSessionToken=${session.userId}%3A%3A${session.accessToken}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Cursor sign-in expired. Sign in inside Cursor and refresh."
      : `Cursor usage request failed (${response.status}).`);
  }
  const { plan, windows } = parseCursorUsageSummary(await response.json());
  return {
    provider: "cursor",
    label: "Cursor",
    connected: true,
    plan,
    windows,
    updatedAt: new Date().toISOString(),
  };
}

// --- Google (Gemini CLI & Antigravity) ---

const GOOGLE_SIGN_IN_MESSAGE = "Google sign-in expired. Sign in with the Gemini CLI or Antigravity and refresh.";

function readGoogleCredentials() {
  try {
    const credentials = JSON.parse(readFileSync(geminiCredentialsPath(), "utf8"));
    if (credentials?.access_token) return credentials;
  } catch {
    // Missing or unreadable credentials are reported as not detected below.
  }
  return null;
}

async function refreshGoogleCredentials(credentials) {
  if (!GEMINI_OAUTH_CLIENT_ID || !GEMINI_OAUTH_CLIENT_SECRET) {
    throw new Error("Google token expired. Use the Gemini CLI or Antigravity once to refresh it (or set GEMINI_OAUTH_CLIENT_ID and GEMINI_OAUTH_CLIENT_SECRET).");
  }
  if (!credentials.refresh_token) throw new Error(GOOGLE_SIGN_IN_MESSAGE);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: GEMINI_OAUTH_CLIENT_ID,
      client_secret: GEMINI_OAUTH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(GOOGLE_SIGN_IN_MESSAGE);
  const refreshed = {
    ...credentials,
    access_token: data.access_token,
    expiry_date: Date.now() + (Number(data.expires_in || 3_600) * 1_000),
    ...(data.id_token ? { id_token: data.id_token } : {}),
  };
  try {
    const path = geminiCredentialsPath();
    const temporaryPath = `${path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(refreshed, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, path);
  } catch {
    // The refreshed token still works for this session even if it cannot be persisted.
  }
  return refreshed;
}

// singleFlight so Gemini and Antigravity loading in parallel share one refresh.
const getGoogleAccessToken = singleFlight(async () => {
  const credentials = readGoogleCredentials();
  if (!credentials) throw new Error(GOOGLE_SIGN_IN_MESSAGE);
  if (Number(credentials.expiry_date || 0) - 60_000 > Date.now()) return credentials.access_token;
  return (await refreshGoogleCredentials(credentials)).access_token;
});

async function cloudCodePost(url, accessToken, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401) throw new Error(GOOGLE_SIGN_IN_MESSAGE);
  if (!response.ok) {
    const error = new Error(`Google usage request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function getGeminiQuota() {
  if (!readGoogleCredentials()) throw notDetectedError("Gemini is not signed in on this device.");
  const accessToken = await getGoogleAccessToken();
  const assist = await cloudCodePost(CLOUD_CODE_LOAD_URL, accessToken, {
    metadata: { ideType: "GEMINI_CLI", pluginType: "GEMINI" },
  }).catch(() => null);
  const project = googleProjectId(assist);
  const quota = await cloudCodePost(CLOUD_CODE_QUOTA_URL, accessToken, project ? { project } : {});
  return {
    provider: "gemini",
    label: "Gemini",
    connected: true,
    plan: googlePlanLabel(assist),
    windows: parseGoogleQuotaBuckets(quota),
    updatedAt: new Date().toISOString(),
  };
}

async function getAntigravityQuota() {
  if (!readGoogleCredentials()) throw notDetectedError("Antigravity is not signed in on this device.");
  const accessToken = await getGoogleAccessToken();
  const assist = await cloudCodePost(CLOUD_CODE_LOAD_URL, accessToken, {
    metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
  }).catch(() => null);
  const project = googleProjectId(assist);
  let models;
  try {
    models = await cloudCodePost(CLOUD_CODE_MODELS_URL, accessToken, project ? { project } : {});
  } catch (error) {
    // Accounts without Antigravity-specific model quotas draw from the shared
    // Gemini pool already shown on the Gemini card, so hide the duplicate.
    if (error.status === 403) throw notDetectedError("Antigravity model quotas are not available for this account.");
    throw error;
  }
  const windows = parseAntigravityModels(models);
  if (!windows.length) throw notDetectedError("Antigravity model quotas are not available for this account.");
  return {
    provider: "antigravity",
    label: "Antigravity",
    connected: true,
    plan: googlePlanLabel(assist),
    windows,
    updatedAt: new Date().toISOString(),
  };
}

// --- GitHub Copilot ---

function readCopilotToken() {
  for (const directory of copilotConfigDirectories()) {
    const files = {};
    try { files.appsJson = readFileSync(join(directory, "apps.json"), "utf8"); } catch { /* optional */ }
    try { files.hostsJson = readFileSync(join(directory, "hosts.json"), "utf8"); } catch { /* optional */ }
    const token = extractCopilotToken(files);
    if (token) return token;
  }
  return null;
}

async function getCopilotQuota() {
  const token = readCopilotToken();
  if (!token) throw notDetectedError("GitHub Copilot is not signed in on this device.");
  const response = await fetch(COPILOT_USAGE_URL, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "Editor-Version": COPILOT_EDITOR_VERSION,
      "Editor-Plugin-Version": COPILOT_PLUGIN_VERSION,
      "User-Agent": COPILOT_USER_AGENT,
      "X-Github-Api-Version": COPILOT_API_VERSION,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("GitHub Copilot sign-in expired. Sign in from your editor and refresh.");
  }
  if (!response.ok) throw new Error(`Copilot usage request failed (${response.status}).`);
  const { plan, windows } = parseCopilotUsage(await response.json());
  return {
    provider: "copilot",
    label: "Copilot",
    connected: true,
    plan,
    windows,
    updatedAt: new Date().toISOString(),
  };
}

const quotaProviders = [
  { provider: "claude", label: "Claude", load: getClaudeQuota, ping: pingClaudeProvider },
  { provider: "codex", label: "Codex", load: getCodexQuota, ping: pingCodexProvider },
  { provider: "kimi", label: "Kimi", load: getKimiQuota, ping: pingKimiProvider },
  { provider: "cursor", label: "Cursor", load: getCursorQuota },
  { provider: "gemini", label: "Gemini", load: getGeminiQuota },
  { provider: "antigravity", label: "Antigravity", load: getAntigravityQuota },
  { provider: "copilot", label: "Copilot", load: getCopilotQuota },
];

async function loadQuotas() {
  const providers = await Promise.allSettled(quotaProviders.map((entry) => entry.load()));
  latestQuotas = providers.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    if (result.reason?.notDetected) return null;
    return {
      provider: quotaProviders[index].provider,
      label: quotaProviders[index].label,
      connected: false,
      retrying: /temporarily rate limited/i.test(result.reason?.message || ""),
      windows: [],
      error: result.reason?.message || "Could not load this provider.",
      updatedAt: new Date().toISOString(),
    };
  }).filter(Boolean);
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

function pingClaudeProvider() {
  return runCli("claude", [
    "--safe-mode",
    "--print",
    PING_PROMPT,
    "--system-prompt",
    "Reply only with the single word pong.",
    "--model",
    CLAUDE_PING_MODEL,
    "--tools",
    "",
    "--no-session-persistence",
    "--output-format",
    "json",
  ], { timeout: PING_TIMEOUT_MS });
}

function pingCodexProvider() {
  return runCli("codex", [
    "exec",
    "--skip-git-repo-check",
    "-s",
    "read-only",
    "--color",
    "never",
    PING_PROMPT,
  ], { timeout: PING_TIMEOUT_MS });
}

function pingKimiProvider() {
  return runCli("kimi", ["-p", PING_PROMPT], { timeout: PING_TIMEOUT_MS });
}

async function pingAllProvidersRequest() {
  const quotas = await getQuotas();
  const connected = new Set(quotas.filter((entry) => entry.connected).map((entry) => entry.provider));
  const targets = quotaProviders.filter((entry) => entry.ping && connected.has(entry.provider));
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

ipcMain.handle("quota:refresh", (_, force = false) => getQuotas(Boolean(force)));
const providerUsagePages = {
  claude: CLAUDE_USAGE_PAGE_URL,
  codex: CODEX_USAGE_PAGE_URL,
  kimi: KIMI_USAGE_PAGE_URL,
  cursor: CURSOR_USAGE_PAGE_URL,
  gemini: GEMINI_USAGE_PAGE_URL,
  antigravity: ANTIGRAVITY_USAGE_PAGE_URL,
  copilot: COPILOT_USAGE_PAGE_URL,
};

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
ipcMain.handle("app:showDashboard", () => showMainWindow());
ipcMain.handle("app:hidePopup", () => popupWindow?.hide());
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
  setAutoPingInterval(loadAutoPingInterval());
  nativeTheme.on("updated", () => {
    if (themePreference === "system") sendToWindows("app:themeChanged", currentThemeState());
  });
  setInterval(() => refreshAndBroadcast(true), AUTO_REFRESH_INTERVAL_MS);
  setTimeout(checkForUpdates, 2_500);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
  app.on("activate", showMainWindow);
});
app.on("before-quit", () => { isQuitting = true; });
