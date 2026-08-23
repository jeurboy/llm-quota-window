// GitHub Copilot: usage from GitHub's internal Copilot endpoint, token read
// from the editor extension's config files.
const { readFileSync } = require("fs");
const { join } = require("path");
const {
  REQUEST_TIMEOUT_MS,
  COPILOT_USAGE_URL,
  COPILOT_USAGE_PAGE_URL,
  COPILOT_API_VERSION,
  COPILOT_EDITOR_VERSION,
  COPILOT_PLUGIN_VERSION,
  COPILOT_USER_AGENT,
  copilotConfigDirectories,
} = require("../config");
const { notDetectedError } = require("../cli");
const { extractCopilotToken, parseCopilotUsage } = require("../copilot-usage");

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

async function load() {
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

module.exports = { provider: "copilot", label: "Copilot", usagePageUrl: COPILOT_USAGE_PAGE_URL, load };
