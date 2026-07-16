const cards = document.querySelector("#cards");
const template = document.querySelector("#card-template");
const refreshButton = document.querySelector("#refresh-button");
const pinButton = document.querySelector("#pin-button");
const themeButton = document.querySelector("#theme-button");
const minimizeButton = document.querySelector("#minimize-button");
const summaryText = document.querySelector("#summary-text");
const lastUpdated = document.querySelector("#last-updated");
const connectionDot = document.querySelector("#connection-dot");
const startOnLoginCheckbox = document.querySelector("#start-on-login");
const updateButton = document.querySelector("#update-button");
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

function windowMarkup(window) {
  const used = Math.round(window.usedPercent);
  const remaining = Math.round(remainingPercent(window));
  const status = remaining <= 10 ? "critical" : remaining <= 30 ? "warning" : "healthy";
  return `
    <section class="quota-window ${status}">
      <div class="ring" style="--remaining:${remaining}">
        <div class="ring-content"><strong>${remaining}%</strong><span>left</span></div>
      </div>
      <div class="window-copy">
        <h2>${window.name}</h2>
        <p>${used}% used${window.durationMinutes ? ` · ${window.durationMinutes >= 1440 ? `${Math.round(window.durationMinutes / 1440)}-day` : `${window.durationMinutes / 60}-hour`} window` : ""}</p>
        <p class="reset" data-reset="${window.resetsAt || ""}">${resetLabel(window.resetsAt)}</p>
      </div>
    </section>`;
}

function render(providers) {
  latestProviders = providers;
  cards.replaceChildren();
  const connectedCount = providers.filter((provider) => provider.connected).length;
  summaryText.textContent = connectedCount === 2 ? "Both local accounts are connected." : `${connectedCount} of 2 local accounts connected.`;
  connectionDot.classList.toggle("offline", connectedCount !== 2);
  const updateTime = providers.map((provider) => provider.updatedAt).filter(Boolean).sort().at(-1);
  lastUpdated.textContent = updateTime ? `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(updateTime))}` : "";

  for (const provider of providers) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.classList.toggle("is-offline", !provider.connected);
    card.querySelector(".provider-name").textContent = provider.label;
    card.querySelector(".plan").textContent = provider.plan ? `${provider.plan} plan` : provider.connected ? "Signed in" : "Not connected";
    const state = card.querySelector(".state");
    state.textContent = provider.connected ? "LIVE" : "ACTION NEEDED";
    state.classList.toggle("offline", !provider.connected);
    card.querySelector(".windows").innerHTML = provider.windows.map(windowMarkup).join("") || "<p class=\"empty\">No quota windows were returned by this account.</p>";
    const error = card.querySelector(".error");
    if (provider.error) { error.hidden = false; error.textContent = provider.error; }
    const tokenUsage = card.querySelector(".token-usage");
    if (provider.tokenUsage) { tokenUsage.hidden = false; tokenUsage.innerHTML = tokenMarkup(provider.tokenUsage); }
    const credits = card.querySelector(".credits");
    credits.textContent = provider.provider === "codex" && provider.credits ? `${provider.credits} reset credits available` : "";
    const pingButton = card.querySelector(".ping-button");
    if (provider.provider === "claude") {
      pingButton.hidden = false;
      pingButton.addEventListener("click", async () => {
        if (!window.confirm("Ping Fable to start or update Claude's 5-hour window? This sends a minimal request and uses a small amount of quota.")) return;
        pingButton.disabled = true;
        pingButton.textContent = "Pinging…";
        try {
          const result = await window.quotaWindow.pingClaude();
          if (result.providers) render(result.providers);
        } catch (error) {
          summaryText.textContent = error.message || "Claude ping failed.";
          connectionDot.classList.add("offline");
        } finally {
          pingButton.disabled = false;
          pingButton.textContent = "Ping Fable";
        }
      });
    }
    card.querySelector(".usage-link").addEventListener("click", () => window.quotaWindow.openUsage(provider.provider));
    cards.append(card);
  }
}

async function refresh() {
  refreshButton.disabled = true;
  refreshButton.textContent = "Checking…";
  try {
    render(await window.quotaWindow.refresh());
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

refreshButton.addEventListener("click", refresh);
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
refresh();
