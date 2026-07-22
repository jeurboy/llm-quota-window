// Central configuration for Quota Window: every API endpoint, credential
// location, and timing constant lives here so a change only touches one file.
const { homedir } = require("os");
const { join } = require("path");

// --- Timings ---
const REQUEST_TIMEOUT_MS = 15_000;
const QUOTA_CACHE_MS = 3 * 60 * 1000;
const AUTO_REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const PING_TIMEOUT_MS = 90_000;
const PING_SETTLE_DELAY_MS = 1_500;
const PING_PROMPT = "Reply only with: pong";
const AUTO_PING_INTERVALS_MINUTES = [0, 30, 60, 120];

// --- App updates & local settings ---
const RELEASES_API_URL = "https://api.github.com/repos/jeurboy/llm-quota-window/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/jeurboy/llm-quota-window/releases";
const DONATE_URL = "https://www.patreon.com/PornprasithMahasith";
const GITHUB_API_VERSION = "2022-11-28";
const SETTINGS_FILE_NAME = "quota-window-settings.json";

// --- CLI resolution ---
// Directories checked for provider CLIs beyond PATH (Electron apps launched
// from Finder do not inherit the shell PATH).
function cliKnownDirectories() {
  return [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".kimi-code", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.APPDATA && join(process.env.APPDATA, "npm"),
  ].filter(Boolean);
}

// --- Claude ---
const CLAUDE_API_VERSION = "2023-06-01";
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_USAGE_PAGE_URL = "https://claude.ai/settings/usage";
const CLAUDE_PING_MODEL = "fable";
const CLAUDE_PROJECTS_ROOT = join(homedir(), ".claude", "projects");

// File fallbacks for older Claude Code versions; macOS prefers the Keychain.
function claudeCredentialPaths() {
  return [
    join(homedir(), ".claude", ".credentials.json"),
    join(homedir(), ".claude", "credentials.json"),
    process.env.APPDATA && join(process.env.APPDATA, "Claude", "credentials.json"),
  ].filter(Boolean);
}

// --- Codex ---
const CODEX_USAGE_PAGE_URL = "https://chatgpt.com/codex/settings/usage";

// --- Kimi ---
// No OAuth client is embedded. Set KIMI_CLIENT_ID (the Kimi Code CLI's public
// client id) to let the app refresh expired tokens itself; otherwise it uses
// the CLI's stored token until the CLI refreshes it.
const KIMI_CLIENT_ID = process.env.KIMI_CLIENT_ID || null;
const KIMI_TOKEN_URL = "https://auth.kimi.com/api/oauth/token";
const KIMI_USAGE_URL = `${(process.env.KIMI_CODE_BASE_URL || "https://api.kimi.com/coding/v1").replace(/\/+$/, "")}/usages`;
const KIMI_USAGE_PAGE_URL = "https://www.kimi.com/code/console";

function kimiCredentialsPath() {
  return join(process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"), "credentials", "kimi-code.json");
}

// --- Google (Gemini CLI & Antigravity) ---
// No OAuth client is embedded. Set GEMINI_OAUTH_CLIENT_ID and
// GEMINI_OAUTH_CLIENT_SECRET (the Gemini CLI's public installed-app client,
// published in google-gemini/gemini-cli) to let the app refresh expired tokens
// itself; otherwise it uses the stored token until the CLI or Antigravity
// refreshes it.
const GEMINI_OAUTH_CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID || null;
const GEMINI_OAUTH_CLIENT_SECRET = process.env.GEMINI_OAUTH_CLIENT_SECRET || null;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_CODE_LOAD_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const CLOUD_CODE_QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const CLOUD_CODE_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const GEMINI_USAGE_PAGE_URL = "https://codeassist.google.com";
const ANTIGRAVITY_USAGE_PAGE_URL = "https://antigravity.google";

function geminiCredentialsPath() {
  return join(homedir(), ".gemini", "oauth_creds.json");
}

// --- GitHub Copilot ---
const COPILOT_USAGE_URL = "https://api.github.com/copilot_internal/user";
const COPILOT_USAGE_PAGE_URL = "https://github.com/settings/copilot";
// Editor identity headers the internal endpoint expects.
const COPILOT_API_VERSION = "2025-04-01";
const COPILOT_EDITOR_VERSION = "vscode/1.96.2";
const COPILOT_PLUGIN_VERSION = "copilot-chat/0.26.7";
const COPILOT_USER_AGENT = "GitHubCopilotChat/0.26.7";

function copilotConfigDirectories() {
  return [
    join(homedir(), ".config", "github-copilot"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "github-copilot"),
    process.env.APPDATA && join(process.env.APPDATA, "github-copilot"),
  ].filter(Boolean);
}

// --- Cursor ---
const CURSOR_USAGE_SUMMARY_URL = "https://cursor.com/api/usage-summary";
const CURSOR_USAGE_PAGE_URL = "https://cursor.com/dashboard?tab=usage";

// The Cursor editor's VS Code-style global state store, which holds its OAuth
// access token.
function cursorStateDbPath() {
  if (process.platform === "win32") {
    return process.env.APPDATA && join(process.env.APPDATA, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Cursor", "User", "globalStorage", "state.vscdb");
}

module.exports = {
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
  DONATE_URL,
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
};
