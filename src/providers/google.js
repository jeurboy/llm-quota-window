// Google: Gemini CLI and Antigravity share one OAuth credential store and
// token refresh, then query separate Cloud Code surfaces for their quotas.
const { existsSync, readFileSync, renameSync, writeFileSync } = require("fs");
const {
  REQUEST_TIMEOUT_MS,
  GEMINI_OAUTH_CLIENT_ID,
  GEMINI_OAUTH_CLIENT_SECRET,
  GOOGLE_TOKEN_URL,
  CLOUD_CODE_LOAD_URL,
  CLOUD_CODE_QUOTA_URL,
  CLOUD_CODE_MODELS_URL,
  GEMINI_USAGE_PAGE_URL,
  ANTIGRAVITY_USAGE_PAGE_URL,
  geminiCredentialsPath,
} = require("../config");
const { notDetectedError } = require("../cli");
const { singleFlight } = require("../single-flight");
const { parseGoogleQuotaBuckets, parseAntigravityModels, googlePlanLabel, googleProjectId } = require("../google-usage");

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

async function loadGemini() {
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

async function loadAntigravity() {
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

module.exports = {
  gemini: { provider: "gemini", label: "Gemini", usagePageUrl: GEMINI_USAGE_PAGE_URL, load: loadGemini },
  antigravity: { provider: "antigravity", label: "Antigravity", usagePageUrl: ANTIGRAVITY_USAGE_PAGE_URL, load: loadAntigravity },
};
