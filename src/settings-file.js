const { readFileSync, writeFileSync } = require("fs");

function readSettingsFile(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function updateSettingsFile(path, changes) {
  const settings = { ...readSettingsFile(path), ...changes };
  writeFileSync(path, JSON.stringify(settings, null, 2), { mode: 0o600 });
  return settings;
}

module.exports = { readSettingsFile, updateSettingsFile };
