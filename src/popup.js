const providersElement = document.querySelector("#popup-providers");
const updatedAt = document.querySelector("#updated-at");
const refreshButton = document.querySelector("#popup-refresh");
const pingButton = document.querySelector("#popup-ping");
const updateButton = document.querySelector("#popup-update");
const themeButton = document.querySelector("#popup-theme");
const popupVersion = document.querySelector("#popup-version");
let themePreference = localStorage.getItem("colorTheme") || "system";
let theme = "dark";
let updateState = { status: "idle" };

function compactTokens(tokens) {
  const value = Number(tokens || 0);
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return new Intl.NumberFormat().format(value);
}

function resetText(resetsAt) {
  if (!resetsAt) return "no reset info";
  const minutes = Math.max(0, Math.floor((new Date(resetsAt).getTime() - Date.now()) / 60_000));
  if (minutes >= 1_440) return `${Math.floor(minutes / 1_440)}d ${Math.floor((minutes % 1_440) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
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

function fitPopup() {
  requestAnimationFrame(() => {
    const panel = document.querySelector(".panel");
    if (panel) window.quotaWindow.fitPopup(panel.getBoundingClientRect().height);
  });
}

function renderProviders(providers) {
  const updateTime = providers.map((provider) => provider.updatedAt).filter(Boolean).sort().at(-1);
  updatedAt.textContent = updateTime
    ? `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(updateTime))}`
    : "Usage unavailable";
  providersElement.innerHTML = providers.length ? providers.map((provider) => {
    if (!provider.connected) return `<article class="provider error"><div class="provider-title"><strong>${provider.label}</strong><span>${provider.retrying ? "Retrying" : "Action needed"}</span></div><p>${provider.error || "Not connected"}</p></article>`;
    const windows = provider.windows.map((window) => {
      const remaining = Math.max(0, Math.min(100, 100 - Math.round(window.usedPercent)));
      const paceRemaining = paceRemainingPercent(window);
      const level = paceLevel(remaining, paceRemaining);
      const paceLine = paceRemaining === null ? "" : `<span class="pace-line" style="left:${paceRemaining}%"></span>`;
      return `<div class="limit"><div class="limit-copy"><strong>${window.name}</strong><span><b class="${level}">${remaining}% left</b> · <b class="${level}">${resetText(window.resetsAt)}</b></span></div><div class="bar"><i class="${level}" style="width:${remaining}%"></i>${paceLine}</div></div>`;
    }).join("");
    const todayTokens = provider.tokenUsage ? `<span class="tokens">${provider.tokenUsage.dayLabel || "today"} ${compactTokens(provider.tokenUsage.dayTokens)} tokens</span>` : "";
    return `<article class="provider"><div class="provider-title"><strong>${provider.label}</strong>${todayTokens}</div>${windows}</article>`;
  }).join("") : "<article class=\"provider error\"><p>No provider accounts were found on this device.</p></article>";
  fitPopup();
}

function renderTheme(themeState) {
  const state = typeof themeState === "string"
    ? { preference: themeState, effective: themeState }
    : themeState;
  themePreference = ["system", "light", "dark"].includes(state.preference) ? state.preference : "system";
  theme = state.effective === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("colorTheme", themePreference);
  themeButton.textContent = themePreference === "system" ? "Auto" : themePreference === "light" ? "Light" : "Dark";
}

function renderUpdate(state) {
  updateState = state;
  updateButton.disabled = state.status === "checking";
  if (state.status === "checking") updateButton.textContent = "Checking…";
  else if (state.status === "available") updateButton.textContent = `Get v${state.latestVersion}`;
  else if (state.status === "up-to-date") updateButton.textContent = "Up to date";
  else if (state.status === "no-releases") updateButton.textContent = "No releases yet";
  else updateButton.textContent = "Check updates";
  updateButton.dataset.status = state.status;
}

async function refresh(force = false) {
  refreshButton.disabled = true;
  refreshButton.classList.add("spinning");
  try { renderProviders(await window.quotaWindow.refresh(force)); }
  finally { refreshButton.disabled = false; refreshButton.classList.remove("spinning"); }
}

refreshButton.addEventListener("click", () => refresh(true));
pingButton.addEventListener("click", async () => {
  pingButton.disabled = true;
  pingButton.textContent = "Pinging…";
  try {
    const result = await window.quotaWindow.pingAll();
    if (result.providers) renderProviders(result.providers);
    const failed = (result.results || []).filter((entry) => !entry.ok);
    if (failed.length) updatedAt.textContent = `Ping failed for ${failed.map((entry) => entry.label).join(", ")}`;
  } catch (error) {
    updatedAt.textContent = error.message || "Ping failed";
  } finally { pingButton.disabled = false; pingButton.textContent = "Ping All"; }
});
updateButton.addEventListener("click", async () => {
  if (updateState.status === "available") await window.quotaWindow.openRelease();
  else renderUpdate(await window.quotaWindow.checkForUpdates());
});
themeButton.addEventListener("click", () => {
  const nextTheme = themePreference === "system" ? "light" : themePreference === "light" ? "dark" : "system";
  window.quotaWindow.setTheme(nextTheme);
});
document.querySelector("#open-dashboard").addEventListener("click", () => window.quotaWindow.showDashboard());
document.querySelector("#popup-support").addEventListener("click", () => window.quotaWindow.openDonate());
window.quotaWindow.onQuotaUpdated(renderProviders);
window.quotaWindow.onThemeChanged(renderTheme);
window.quotaWindow.onUpdateStateChanged(renderUpdate);
window.quotaWindow.setTheme(themePreference).then(renderTheme);
window.quotaWindow.getVersion().then((version) => { popupVersion.textContent = `v${version}`; });
refresh();
