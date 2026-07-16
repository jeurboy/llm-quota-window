const providersElement = document.querySelector("#popup-providers");
const updatedAt = document.querySelector("#updated-at");
const refreshButton = document.querySelector("#popup-refresh");
const pingButton = document.querySelector("#popup-ping");
const updateButton = document.querySelector("#popup-update");
const themeButton = document.querySelector("#popup-theme");
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
  if (!resetsAt) return "Reset unavailable";
  const minutes = Math.max(0, Math.floor((new Date(resetsAt).getTime() - Date.now()) / 60_000));
  if (minutes >= 1_440) return `Resets in ${Math.floor(minutes / 1_440)}d ${Math.floor((minutes % 1_440) / 60)}h`;
  if (minutes >= 60) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `Resets in ${minutes}m`;
}

function renderProviders(providers) {
  const updateTime = providers.map((provider) => provider.updatedAt).filter(Boolean).sort().at(-1);
  updatedAt.textContent = updateTime
    ? `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(updateTime))}`
    : "Usage unavailable";
  providersElement.innerHTML = providers.map((provider) => {
    if (!provider.connected) return `<article class="provider error"><div class="provider-title"><strong>${provider.label}</strong><span>${provider.retrying ? "Retrying" : "Action needed"}</span></div><p>${provider.error || "Not connected"}</p></article>`;
    const windows = provider.windows.map((window) => {
      const used = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
      return `<div class="limit"><div class="limit-copy"><strong>${window.name}</strong><span>${100 - used}% left · ${resetText(window.resetsAt)}</span></div><div class="bar"><i style="width:${100 - used}%"></i></div></div>`;
    }).join("");
    const todayTokens = provider.tokenUsage ? `<span class="tokens">${provider.tokenUsage.dayLabel || "today"} ${compactTokens(provider.tokenUsage.dayTokens)} tokens</span>` : "";
    return `<article class="provider"><div class="provider-title"><strong>${provider.label}</strong>${todayTokens}</div>${windows}</article>`;
  }).join("");
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
  try { const result = await window.quotaWindow.pingClaude(); if (result.providers) renderProviders(result.providers); }
  finally { pingButton.disabled = false; pingButton.textContent = "Ping Fable"; }
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
window.quotaWindow.onQuotaUpdated(renderProviders);
window.quotaWindow.onThemeChanged(renderTheme);
window.quotaWindow.onUpdateStateChanged(renderUpdate);
window.quotaWindow.setTheme(themePreference).then(renderTheme);
refresh();
