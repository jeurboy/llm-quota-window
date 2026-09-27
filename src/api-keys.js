// Local, per-device storage for API keys the user has typed in the UI.
// Keys are read by API-key providers as a fallback when the matching
// environment variable is not set. They are never uploaded.
//
// The settings file lives in Electron's per-user data directory (the same
// file main.js uses for auto-ping and disabled-provider preferences).
const { join } = require("path");
const { app } = require("electron");
const { SETTINGS_FILE_NAME } = require("./config");
const { readSettingsFile, updateSettingsFile } = require("./settings-file");

function settingsPath() {
  return join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

// Returns a fresh settings object from disk, or {} when unreadable.
function readSettings() {
  return readSettingsFile(settingsPath());
}

// Returns the entire stored key map: { provider: "key" }.
function getApiKeys() {
  const keys = readSettings().apiKeys;
  return keys && typeof keys === "object" ? keys : {};
}

// Returns the single key stored for a provider, or null.
function getApiKey(provider) {
  return getApiKeys()[provider] || null;
}

// Stores or clears one provider's key and returns the updated map.
function setApiKey(provider, key) {
  const settings = readSettings();
  const keys = settings.apiKeys && typeof settings.apiKeys === "object" ? settings.apiKeys : {};
  if (key && String(key).trim()) keys[provider] = String(key).trim();
  else delete keys[provider];
  settings.apiKeys = keys;
  updateSettingsFile(settingsPath(), { apiKeys: keys });
  return keys;
}

module.exports = { getApiKeys, getApiKey, setApiKey };
