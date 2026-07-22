const cards = document.querySelector("#cards");
const template = document.querySelector("#card-template");
const refreshButton = document.querySelector("#refresh-button");
const pingAllButton = document.querySelector("#ping-all-button");
const pinButton = document.querySelector("#pin-button");
const themeButton = document.querySelector("#theme-button");
const minimizeButton = document.querySelector("#minimize-button");
const summaryText = document.querySelector("#summary-text");
const lastUpdated = document.querySelector("#last-updated");
const connectionDot = document.querySelector("#connection-dot");
const startOnLoginCheckbox = document.querySelector("#start-on-login");
const updateButton = document.querySelector("#update-button");
const appVersion = document.querySelector("#app-version");
let latestProviders = [];
let alwaysOnTop = localStorage.getItem("alwaysOnTop") === "true";
let themePreference = localStorage.getItem("colorTheme") || "system";
let colorTheme = "dark";

function renderTheme(themeState) {
  const state = typeof themeState === "string"
    ? { preference: themeState, effective: themeState }
    : themeState;
  themePreference = ["system", "light", "dark"].includes(state.preference) ? state.preference : "system";
  colorTheme = state.effective === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = colorTheme;
  themeButton.classList.toggle("active", themePreference !== "dark");
  themeButton.textContent = themePreference === "system" ? "Auto" : themePreference === "light" ? "Light" : "Dark";
  themeButton.title = "Cycle theme: Auto, Light, Dark";
}

function renderPinState(enabled) {
  alwaysOnTop = enabled;
  pinButton.classList.toggle("active", enabled);
  pinButton.setAttribute("aria-pressed", String(enabled));
  pinButton.textContent = enabled ? "Pinned" : "Pin";
  pinButton.title = enabled ? "Allow window behind others" : "Keep window on top";
}

function renderUpdateState(state) {
  updateButton.disabled = state.status === "checking";
  if (state.status === "checking") updateButton.textContent = "Checking…";
  else if (state.status === "available") updateButton.textContent = `Get v${state.latestVersion}`;
  else if (state.status === "up-to-date") updateButton.textContent = `Up to date · v${state.currentVersion}`;
  else if (state.status === "no-releases") updateButton.textContent = "No releases yet";
  else if (state.status === "error") updateButton.textContent = "Update check failed";
  else updateButton.textContent = "Check updates";
  updateButton.dataset.status = state.status;
}

function remainingPercent(window) {
  return Math.max(0, Math.min(100, 100 - window.usedPercent));
}

function formatDuration(totalSeconds) {
  if (totalSeconds <= 0) return "resetting now";
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function resetLabel(resetsAt) {
  if (!resetsAt) return "Reset time unavailable";
  const seconds = Math.floor((new Date(resetsAt).getTime() - Date.now()) / 1000);
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", weekday: "short" }).format(new Date(resetsAt));
  return `Resets in ${formatDuration(seconds)} · ${clock}`;
}

function formatTokens(tokens) {
  const amount = Number(tokens || 0);
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return new Intl.NumberFormat().format(amount);
}

function tokenMarkup(tokenUsage) {
  if (!tokenUsage) return "";
  const day = tokenUsage.dayLabel || (tokenUsage.day
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${tokenUsage.day}T12:00:00`))
    : "today");
  return `
    <p class="token-title">TOKEN USAGE <span>${tokenUsage.source}</span></p>
    <div class="token-grid">
      <div><strong>${formatTokens(tokenUsage.dayTokens)}</strong><span>${day}</span></div>
      ${tokenUsage.lifetimeTokens !== null && tokenUsage.lifetimeTokens !== undefined ? `<div><strong>${formatTokens(tokenUsage.lifetimeTokens)}</strong><span>lifetime</span></div>` : ""}
      ${tokenUsage.peakDailyTokens !== null && tokenUsage.peakDailyTokens !== undefined ? `<div><strong>${formatTokens(tokenUsage.peakDailyTokens)}</strong><span>peak day</span></div>` : ""}
    </div>`;
}

// How much quota should remain under an hourly-stepped time budget: every
// window grants each hour's share up front (a weekly window budgets 100/168
// per hour, a 5-hour window 100/5). Null when the window has no usable
// duration or reset time. Doubles as the green/red divider position.
function paceRemainingPercent(window) {
  const totalMs = Number(window.durationMinutes) * 60_000;
  const remainingMs = window.resetsAt ? new Date(window.resetsAt).getTime() - Date.now() : 0;
  if (!totalMs || remainingMs <= 0 || remainingMs >= totalMs) return null;
  const unitMs = 3_600_000;
  const budgetMs = Math.min(totalMs, Math.ceil((totalMs - remainingMs) / unitMs) * unitMs);
  return Math.max(0, Math.min(100, 100 * (1 - budgetMs / totalMs)));
}

// Colour each window by consumption pace: using quota slower than the
// elapsed-time share stays green; running ahead of pace turns amber, then red,
// and anything nearly exhausted is always red.
function paceLevel(remaining, paceRemaining) {
  if (remaining <= 10) return "critical";
  if (paceRemaining === null) return remaining <= 30 ? "warning" : "healthy";
  const overBudget = paceRemaining - remaining;
  if (overBudget <= 0) return "healthy";
  return overBudget <= 15 ? "warning" : "critical";
}

function windowMarkup(window) {
  const used = Math.round(window.usedPercent);
  const remaining = Math.round(remainingPercent(window));
  const paceRemaining = paceRemainingPercent(window);
  const status = paceLevel(remaining, paceRemaining);
  const ringStyle = `--remaining:${remaining}${paceRemaining === null ? "" : `; --pace:${paceRemaining}`}`;
  return `
    <section class="quota-window ${status}">
      <div class="ring${paceRemaining === null ? "" : " has-pace"}" style="${ringStyle}">
        <div class="ring-content"><strong>${remaining}%</strong><span>left</span></div>
      </div>
      <div class="window-copy">
        <h2>${window.name}</h2>
        <p>${used}% used${window.durationMinutes ? ` · ${window.durationMinutes >= 1440 ? `${Math.round(window.durationMinutes / 1440)}-day` : `${window.durationMinutes / 60}-hour`} window` : ""}</p>
        <p class="reset ${status}" data-reset="${window.resetsAt || ""}">${resetLabel(window.resetsAt)}</p>
      </div>
    </section>`;
}

function render(providers) {
  latestProviders = providers;
  cards.replaceChildren();
  const connectedCount = providers.filter((provider) => provider.connected).length;
  const retryingCount = providers.filter((provider) => provider.retrying).length;
  summaryText.textContent = !providers.length
    ? "No provider accounts were found on this device."
    : retryingCount
      ? `${retryingCount} account is rate limited and will retry automatically.`
      : connectedCount === providers.length ? "All local accounts are connected." : `${connectedCount} of ${providers.length} local accounts connected.`;
  connectionDot.classList.toggle("offline", !providers.length || connectedCount !== providers.length);
  const updateTime = providers.map((provider) => provider.updatedAt).filter(Boolean).sort().at(-1);
  lastUpdated.textContent = updateTime ? `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(updateTime))}` : "";

  for (const provider of providers) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.classList.toggle("is-offline", !provider.connected);
    card.querySelector(".provider-name").textContent = provider.label;
    card.querySelector(".plan").textContent = provider.plan ? `${provider.plan} plan` : provider.connected ? "Signed in" : "Not connected";
    const state = card.querySelector(".state");
    state.textContent = provider.retrying ? "RETRYING" : provider.connected ? "LIVE" : "ACTION NEEDED";
    state.classList.toggle("offline", !provider.connected && !provider.retrying);
    state.classList.toggle("retrying", Boolean(provider.retrying));
    card.querySelector(".windows").innerHTML = provider.windows.map(windowMarkup).join("") || "<p class=\"empty\">No quota windows were returned by this account.</p>";
    const error = card.querySelector(".error");
    if (provider.error) { error.hidden = false; error.textContent = provider.error; }
    const tokenUsage = card.querySelector(".token-usage");
    if (provider.tokenUsage) { tokenUsage.hidden = false; tokenUsage.innerHTML = tokenMarkup(provider.tokenUsage); }
    const credits = card.querySelector(".credits");
    credits.textContent = provider.provider === "codex" && provider.credits ? `${provider.credits} reset credits available` : "";
    card.querySelector(".usage-link").addEventListener("click", () => window.quotaWindow.openUsage(provider.provider));
    cards.append(card);
  }
}

async function refresh(force = false) {
  refreshButton.disabled = true;
  refreshButton.textContent = "Checking…";
  try {
    render(await window.quotaWindow.refresh(force));
  } catch (error) {
    summaryText.textContent = error.message || "Could not refresh quota windows.";
    connectionDot.classList.add("offline");
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh now";
  }
}

function updateCountdowns() {
  document.querySelectorAll("[data-reset]").forEach((element) => { element.textContent = resetLabel(element.dataset.reset || null); });
}

refreshButton.addEventListener("click", () => refresh(true));
pingAllButton.addEventListener("click", async () => {
  if (!window.confirm("Ping every connected provider to start or update its usage window? This sends one minimal request per provider and uses a small amount of quota.")) return;
  pingAllButton.disabled = true;
  pingAllButton.textContent = "Pinging…";
  try {
    const result = await window.quotaWindow.pingAll();
    if (result.providers) render(result.providers);
    const failed = (result.results || []).filter((entry) => !entry.ok);
    if (failed.length) {
      summaryText.textContent = `Ping failed for ${failed.map((entry) => entry.label).join(", ")}. Other providers were pinged.`;
      connectionDot.classList.add("offline");
    }
  } catch (error) {
    summaryText.textContent = error.message || "Ping failed.";
    connectionDot.classList.add("offline");
  } finally {
    pingAllButton.disabled = false;
    pingAllButton.textContent = "Ping All";
  }
});
minimizeButton.addEventListener("click", () => window.quotaWindow.minimize());
pinButton.addEventListener("click", async () => {
  const enabled = await window.quotaWindow.setAlwaysOnTop(!alwaysOnTop);
  localStorage.setItem("alwaysOnTop", String(enabled));
  renderPinState(enabled);
});
themeButton.addEventListener("click", async () => {
  const nextTheme = themePreference === "system" ? "light" : themePreference === "light" ? "dark" : "system";
  const state = await window.quotaWindow.setTheme(nextTheme);
  localStorage.setItem("colorTheme", state.preference);
  renderTheme(state);
});
startOnLoginCheckbox.addEventListener("change", async () => {
  startOnLoginCheckbox.disabled = true;
  try {
    startOnLoginCheckbox.checked = await window.quotaWindow.setStartOnLogin(startOnLoginCheckbox.checked);
  } finally {
    startOnLoginCheckbox.disabled = false;
  }
});
updateButton.addEventListener("click", async () => {
  if (updateButton.dataset.status === "available") {
    await window.quotaWindow.openRelease();
    return;
  }
  renderUpdateState(await window.quotaWindow.checkForUpdates());
});
window.quotaWindow.onRefreshRequested(refresh);
window.quotaWindow.onQuotaUpdated(render);
window.quotaWindow.onAlwaysOnTopChanged((enabled) => {
  localStorage.setItem("alwaysOnTop", String(enabled));
  renderPinState(enabled);
});
window.quotaWindow.onThemeChanged((state) => {
  localStorage.setItem("colorTheme", state.preference);
  renderTheme(state);
});
window.quotaWindow.onStartOnLoginChanged((enabled) => { startOnLoginCheckbox.checked = enabled; });
window.quotaWindow.onUpdateStateChanged(renderUpdateState);
setInterval(updateCountdowns, 1000);
window.quotaWindow.setAlwaysOnTop(alwaysOnTop).then(renderPinState);
window.quotaWindow.setTheme(themePreference).then(renderTheme);
window.quotaWindow.getStartOnLogin().then((enabled) => { startOnLoginCheckbox.checked = enabled; });
window.quotaWindow.getVersion().then((version) => { appVersion.textContent = `v${version}`; });
refresh();
