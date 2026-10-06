const cards = document.querySelector("#cards");
const template = document.querySelector("#card-template");
const refreshButton = document.querySelector("#refresh-button");
const pingAllButton = document.querySelector("#ping-all-button");
const pinButton = document.querySelector("#pin-button");
const themeButton = document.querySelector("#theme-button");
const minimizeButton = document.querySelector("#minimize-button");
const providersButton = document.querySelector("#providers-button");
const providersPanel = document.querySelector("#providers-panel");
const providerToggles = document.querySelector("#provider-toggles");
const apiKeyInputs = document.querySelector("#api-key-inputs");
const closeProvidersButton = document.querySelector("#close-providers-button");
const summaryText = document.querySelector("#summary-text");
const lastUpdated = document.querySelector("#last-updated");
const connectionDot = document.querySelector("#connection-dot");
const startOnLoginCheckbox = document.querySelector("#start-on-login");
const updateButton = document.querySelector("#update-button");
const supportButton = document.querySelector("#support-button");
const appVersion = document.querySelector("#app-version");
let latestProviders = [];
let alwaysOnTop = localStorage.getItem("alwaysOnTop") === "true";
let themePreference = localStorage.getItem("colorTheme") || "system";
let colorTheme = "dark";

function renderProviderSettings(settings) {
  providerToggles.replaceChildren();
  apiKeyInputs.replaceChildren();
  for (const provider of settings) {
    const label = document.createElement("label");
    label.className = "provider-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = provider.enabled;
    checkbox.addEventListener("change", async () => {
      checkbox.disabled = true;
      try {
        await window.quotaWindow.setProviderEnabled(provider.provider, checkbox.checked);
      } catch {
        checkbox.checked = !checkbox.checked;
      } finally {
        checkbox.disabled = false;
      }
    });
    const name = document.createElement("span");
    name.textContent = provider.label;
    label.append(checkbox, name);
    providerToggles.append(label);

    if (provider.usesApiKey) {
      apiKeyInputs.append(renderApiKeyRow(provider));
    }
  }
}

function renderApiKeyRow(provider) {
  const row = document.createElement("div");
  row.className = "api-key-row";
  const label = document.createElement("label");
  label.className = "api-key-row-label";
  label.textContent = provider.label;
  const input = document.createElement("input");
  input.type = "password";
  input.className = "api-key-row-input";
  input.placeholder = provider.apiKeySet
    ? "•••••••• (saved)"
    : provider.keyFormat
      ? `Not set — e.g. ${provider.keyFormat}`
      : "Not set — uses env var";
  input.autocomplete = "off";
  input.spellcheck = false;
  const save = document.createElement("button");
  save.type = "button";
  save.className = "api-key-row-save";
  save.textContent = "Save";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "api-key-row-clear";
  clear.textContent = "Clear";
  clear.title = "Remove the stored key and fall back to the environment variable";

  const status = document.createElement("span");
  status.className = "api-key-row-status";

  save.addEventListener("click", async () => {
    const value = input.value.trim();
    if (!value) {
      status.textContent = "Enter a key first.";
      return;
    }
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      await window.quotaWindow.setApiKey(provider.provider, value);
      input.value = "";
      input.placeholder = "•••••••• (saved)";
      status.textContent = "Saved.";
      setTimeout(() => { status.textContent = ""; }, 2000);
    } catch (error) {
      status.textContent = error.message || "Could not save.";
    } finally {
      save.disabled = false;
      save.textContent = "Save";
    }
  });

  clear.addEventListener("click", async () => {
    clear.disabled = true;
    try {
      await window.quotaWindow.setApiKey(provider.provider, "");
      input.value = "";
      input.placeholder = "Not set — uses env var";
      status.textContent = "Cleared.";
      setTimeout(() => { status.textContent = ""; }, 2000);
    } catch (error) {
      status.textContent = error.message || "Could not clear.";
    } finally {
      clear.disabled = false;
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save.click();
  });

  row.append(label, input, save, clear, status);
  return row;
}

function toggleProvidersPanel(show = providersPanel.hidden) {
  providersPanel.hidden = !show;
  providersButton.classList.toggle("active", show);
  providersButton.setAttribute("aria-expanded", String(show));
  if (show) window.quotaWindow.getProviderSettings().then(renderProviderSettings);
}

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
// duration or reset time. Doubles as the green/red divider position. A reset
// further out than the window length (estimated duration, clock skew) counts
// as a just-opened budget, so the marker stays visible at 100%.
function paceRemainingPercent(window) {
  const totalMs = Number(window.durationMinutes) * 60_000;
  const remainingMs = window.resetsAt ? new Date(window.resetsAt).getTime() - Date.now() : 0;
  if (!totalMs || remainingMs <= 0) return null;
  const unitMs = 3_600_000;
  const budgetMs = Math.min(totalMs, Math.ceil(Math.max(0, totalMs - remainingMs) / unitMs) * unitMs);
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
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
        <h2>${escapeHtml(window.name)}</h2>
        <p>${used}% used${window.durationMinutes ? ` · ${window.durationMinutes >= 1440 ? `${Math.round(window.durationMinutes / 1440)}-day` : `${window.durationMinutes / 60}-hour`} window` : ""}</p>
      </div>
      <p class="reset ${status}" data-reset="${window.resetsAt || ""}">${resetLabel(window.resetsAt)}</p>
    </section>`;
}

// Bento tile size per provider: a lone window gets a compact single-column
// tile, three windows a wide row, and four or more a tall double tile whose
// windows sit in a 2×2 grid. Anything with extra content (token usage, errors,
// key entry, Kimi's web sign-in) needs at least the medium tile.
function tileSize(provider) {
  const count = provider.windows.length;
  if (count >= 4) return "bento-xl";
  if (count === 3) return "bento-l";
  const hasExtras = provider.tokenUsage || provider.error || provider.needsApiKey || provider.provider === "kimi";
  return count <= 1 && !hasExtras ? "bento-s" : "bento-m";
}

// Summary tile closing the bento grid: the tightest window across every
// provider and the next reset to happen.
function overviewCard(providers) {
  const windows = providers.flatMap((provider) => provider.windows.map((window) => ({ provider, window })));
  if (!windows.length) return null;
  const tightest = windows.reduce((low, entry) => remainingPercent(entry.window) < remainingPercent(low.window) ? entry : low);
  const upcoming = windows
    .filter((entry) => entry.window.resetsAt && new Date(entry.window.resetsAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.window.resetsAt) - new Date(b.window.resetsAt))[0];
  const remaining = Math.round(remainingPercent(tightest.window));
  const status = paceLevel(remaining, paceRemainingPercent(tightest.window));
  const providerCount = new Set(windows.map((entry) => entry.provider.provider)).size;
  const card = document.createElement("article");
  card.className = "provider-card overview-card bento-s";
  card.innerHTML = `
    <p class="overview-eyebrow">AT A GLANCE</p>
    <div class="overview-stat ${status}"><strong>${remaining}%</strong><span>lowest left</span></div>
    <p class="overview-label">${escapeHtml(tightest.provider.label)} · ${escapeHtml(tightest.window.name)}</p>
    ${upcoming ? `
    <div class="overview-next">
      <span>NEXT RESET</span>
      <p class="overview-label">${escapeHtml(upcoming.provider.label)} · ${escapeHtml(upcoming.window.name)}</p>
      <p class="reset" data-reset="${upcoming.window.resetsAt}">${resetLabel(upcoming.window.resetsAt)}</p>
    </div>` : ""}
    <p class="overview-foot">${windows.length} window${windows.length === 1 ? "" : "s"} · ${providerCount} provider${providerCount === 1 ? "" : "s"}</p>`;
  return card;
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
    card.classList.add(tileSize(provider));
    card.classList.toggle("is-offline", !provider.connected);
    card.querySelector(".provider-name").textContent = provider.label;
    card.querySelector(".plan").textContent = provider.plan
      ? /plan$/i.test(provider.plan) ? provider.plan : `${provider.plan} plan`
      : provider.connected ? "Signed in" : "Not connected";
    const state = card.querySelector(".state");
    state.textContent = provider.retrying ? "RETRYING" : provider.connected ? "LIVE" : "ACTION NEEDED";
    state.classList.toggle("offline", !provider.connected && !provider.retrying);
    state.classList.toggle("retrying", Boolean(provider.retrying));
    card.querySelector(".windows").innerHTML = provider.windows.map(windowMarkup).join("") ||
      (provider.needsWebLogin ? "<p class=\"empty\">Sign in to see your MiMo usage.</p>" : "<p class=\"empty\">No quota windows were returned by this account.</p>");
    const error = card.querySelector(".error");
    if (provider.error) { error.hidden = false; error.textContent = provider.error; }
    if (provider.needsApiKey) renderApiKeyInput(card, provider);
    const tokenUsage = card.querySelector(".token-usage");
    if (provider.tokenUsage) { tokenUsage.hidden = false; tokenUsage.innerHTML = tokenMarkup(provider.tokenUsage); }
    const credits = card.querySelector(".credits");
    credits.textContent = provider.creditSummary || (provider.provider === "codex" && provider.credits ? `${provider.credits} reset credits available` : "");
    if (provider.provider === "kimi") renderKimiWebControls(card, provider);
    if (provider.provider === "mimo") renderMimoWebControls(card, provider);
    renderDisconnectControl(card, provider);
    card.querySelector(".usage-link").addEventListener("click", () => window.quotaWindow.openUsage(provider.provider));
    cards.append(card);
  }
  const overview = overviewCard(providers);
  if (overview) cards.append(overview);
}

function renderMimoWebControls(card, provider) {
  if (!provider.needsWebLogin) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "usage-link";
  button.textContent = "Sign in to MiMo";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await window.quotaWindow.mimoOpenLogin();
    } catch {
      button.disabled = false;
      return;
    }
    button.disabled = false;
  });
  card.querySelector(".action-buttons").append(button);
}

function renderDisconnectControl(card, provider) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "usage-link disconnect-link";
  button.textContent = "Disconnect";
  button.setAttribute("aria-label", `Disconnect ${provider.label} from Quota Window`);
  button.title = "Stop monitoring here and remove any key or web sign-in saved by Quota Window. Re-enable in Providers.";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      render(await window.quotaWindow.disconnectProvider(provider.provider));
      summaryText.textContent = `${provider.label} disconnected. Re-enable it in Providers.`;
    } catch (error) {
      summaryText.textContent = error.message || `Could not disconnect ${provider.label}.`;
      button.disabled = false;
    }
  });
  card.querySelector(".action-buttons").append(button);
}

// Renders an inline API-key entry form on the provider card when the provider
// is waiting for the user to paste a key it cannot find elsewhere. Saving
// stores the key on this device and triggers a refresh to apply it.
function renderApiKeyInput(card, provider) {
  const panel = document.createElement("div");
  panel.className = "api-key-panel";
  const label = document.createElement("label");
  label.className = "api-key-label";
  label.textContent = `Paste your ${provider.label} API key — stored locally on this device, never uploaded.`;
  const row = document.createElement("div");
  row.className = "api-key-row";
  const input = document.createElement("input");
  input.type = "password";
  input.className = "api-key-input";
  input.placeholder = provider.keyFormat || "sk-...";
  input.autocomplete = "off";
  input.spellcheck = false;
  const save = document.createElement("button");
  save.type = "button";
  save.className = "api-key-save";
  save.textContent = "Save key";
  const status = document.createElement("p");
  status.className = "api-key-status";
  save.addEventListener("click", async () => {
    const value = input.value.trim();
    if (!value) {
      status.textContent = "Enter a key first.";
      return;
    }
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      await window.quotaWindow.setApiKey(provider.provider, value);
      status.textContent = "Saved. Refreshing…";
    } catch (error) {
      status.textContent = error.message || "Could not save the key.";
      save.disabled = false;
      save.textContent = "Save key";
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save.click();
  });
  row.append(input, save);
  panel.append(label, row, status);
  card.querySelector(".error").after(panel);
}

// Monthly membership quota needs a separate kimi.com web sign-in (QR scan
// with the Kimi app); offer it on the Kimi card when not yet connected.
function renderKimiWebControls(card, provider) {
  const actions = card.querySelector(".action-buttons");
  if (!provider.webSignedIn) {
    const signIn = document.createElement("button");
    signIn.type = "button";
    signIn.className = "usage-link kimi-signin";
    signIn.textContent = "Sign in for monthly quota";
    signIn.addEventListener("click", () => showKimiSignIn(card, signIn));
    actions.append(signIn);
  } else {
    const signOut = document.createElement("button");
    signOut.type = "button";
    signOut.className = "usage-link kimi-signout";
    signOut.textContent = "Disconnect web";
    signOut.title = "Remove the stored kimi.com web sign-in";
    signOut.addEventListener("click", () => window.quotaWindow.kimiSignOutWeb().then((providers) => providers && render(providers)).catch(() => {}));
    actions.append(signOut);
  }
}

async function showKimiSignIn(card, button) {
  button.disabled = true;
  button.textContent = "Loading QR…";
  card.querySelector(".qr-panel")?.remove();
  const panel = document.createElement("div");
  panel.className = "qr-panel";
  const status = document.createElement("p");
  status.className = "qr-status";
  const resetButton = () => {
    button.disabled = false;
    button.textContent = "Sign in for monthly quota";
  };
  try {
    const { qrDataUrl } = await window.quotaWindow.kimiStartWebLogin();
    const image = document.createElement("img");
    image.src = qrDataUrl;
    image.alt = "Kimi sign-in QR code";
    status.textContent = "Scan with the Kimi mobile app to show monthly membership quota.";
    panel.append(image, status);
  } catch (error) {
    status.textContent = error.message || "Could not start Kimi sign-in.";
    panel.append(status);
    resetButton();
  }
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "qr-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", async () => {
    await window.quotaWindow.kimiCancelWebLogin();
    panel.remove();
    resetButton();
  });
  panel.append(cancel);
  card.querySelector(".card-actions").before(panel);
}

window.quotaWindow.onKimiWebLoginChanged((state) => {
  const panel = document.querySelector(".qr-panel");
  if (!panel) return;
  const status = panel.querySelector(".qr-status");
  if (state.status === "scanned") status.textContent = "Scanned — confirm on your phone…";
  if (state.status === "expired") status.textContent = "Code expired — cancel and try again.";
  if (state.status === "success") {
    panel.remove();
    refresh(true);
  }
});

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
providersButton.addEventListener("click", () => toggleProvidersPanel());
closeProvidersButton.addEventListener("click", () => toggleProvidersPanel(false));
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
supportButton.addEventListener("click", () => window.quotaWindow.openDonate());
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
window.quotaWindow.onProviderSettingsChanged((settings) => {
  renderProviderSettings(settings);
});
setInterval(updateCountdowns, 1000);
window.quotaWindow.setAlwaysOnTop(alwaysOnTop).then(renderPinState);
window.quotaWindow.setTheme(themePreference).then(renderTheme);
window.quotaWindow.getStartOnLogin().then((enabled) => { startOnLoginCheckbox.checked = enabled; });
window.quotaWindow.getVersion().then((version) => { appVersion.textContent = `v${version}`; });
window.quotaWindow.getProviderSettings().then(renderProviderSettings);
refresh();
