// Google: Gemini CLI and Antigravity share one unified provider card, reading
// Antigravity's OS keyring credentials (and Gemini CLI's oauth_creds.json
// fallback) and querying Cloud Code for daily Gemini tier quotas and
// Antigravity model/group allowances.
const { existsSync, readFileSync, renameSync, writeFileSync } = require("fs");
const {
  REQUEST_TIMEOUT_MS,
  GEMINI_OAUTH_CLIENT_ID,
  GEMINI_OAUTH_CLIENT_SECRET,
  ANTIGRAVITY_OAUTH_CLIENT_ID,
  ANTIGRAVITY_OAUTH_CLIENT_SECRET,
  GOOGLE_TOKEN_URL,
  CLOUD_CODE_LOAD_URL,
  CLOUD_CODE_QUOTA_SUMMARY_URL,
  CLOUD_CODE_QUOTA_URL,
  CLOUD_CODE_MODELS_URL,
  GEMINI_USAGE_PAGE_URL,
  geminiCredentialsPath,
  geminiCredentialPaths,
} = require("../config");
const { notDetectedError, resolveCli } = require("../cli");
const { singleFlight } = require("../single-flight");
const {
  parseGoogleQuotaBuckets,
  parseGoogleQuotaSummary,
  parseAntigravityModels,
  googlePlanLabel,
  googleProjectId,
  extractGoogleOAuthClients,
} = require("../google-usage");

const GOOGLE_LABEL = "Gemini / Antigravity";
const GOOGLE_SIGN_IN_MESSAGE = "Google sign-in expired. Sign in with the Gemini CLI or Antigravity and refresh.";
const ANTIGRAVITY_USER_AGENT = "antigravity/1.4.12 darwin/arm64";

function parseKeyringPayload(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const decoded = trimmed.startsWith("go-keyring-base64:")
    ? Buffer.from(trimmed.slice("go-keyring-base64:".length), "base64").toString("utf8")
    : trimmed;
  const parsed = JSON.parse(decoded);
  const token = parsed?.token || parsed;
  if (!token?.access_token && !token?.refresh_token) return null;
  const expiryMs = token.expiry ? new Date(token.expiry).getTime() : Number(token.expiry_date || 0);
  return {
    source: "keychain",
    rawParsed: parsed,
    access_token: token.access_token || null,
    refresh_token: token.refresh_token || null,
    expiry_date: Number.isFinite(expiryMs) ? expiryMs : 0,
  };
}

function readAntigravityKeychainCredentials() {
  if (process.platform === "darwin") {
    try {
      const raw = require("child_process").execFileSync(
        "security",
        ["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"],
        { encoding: "utf8", timeout: 5_000, windowsHide: true },
      );
      return parseKeyringPayload(raw);
    } catch {
      // Fall through if not stored in macOS Keychain.
    }
  }
  return null;
}

function writeAntigravityKeychainCredentials(rawParsed, refreshed) {
  if (process.platform !== "darwin" || !rawParsed || typeof rawParsed !== "object") return;
  try {
    const updated = {
      ...rawParsed,
      token: {
        ...(rawParsed.token || {}),
        access_token: refreshed.access_token,
        expiry: new Date(refreshed.expiry_date).toISOString(),
      },
    };
    const encoded = `go-keyring-base64:${Buffer.from(JSON.stringify(updated), "utf8").toString("base64")}`;
    require("child_process").execFileSync(
      "security",
      ["add-generic-password", "-U", "-s", "gemini", "-a", "antigravity", "-w", encoded],
      { encoding: "utf8", timeout: 5_000, windowsHide: true },
    );
  } catch {
    // Non-fatal: refreshed token is still used in memory.
  }
}

function readGoogleFileCredentials() {
  const candidates = typeof geminiCredentialPaths === "function"
    ? geminiCredentialPaths()
    : [geminiCredentialsPath()];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const credentials = JSON.parse(readFileSync(path, "utf8"));
      if (credentials?.access_token || credentials?.refresh_token) {
        return { ...credentials, source: "file", filePath: path };
      }
    } catch {
      // Try the next candidate credential location.
    }
  }
  return null;
}

function readGoogleCredentialCandidates() {
  const list = [];
  const keychain = readAntigravityKeychainCredentials();
  if (keychain) list.push(keychain);
  const file = readGoogleFileCredentials();
  if (file) list.push(file);
  return list;
}

let discoveredOAuthClients = null;

function discoverLocalOAuthClients() {
  if (discoveredOAuthClients) return discoveredOAuthClients;
  const clients = [];
  for (const command of ["agy", "gemini"]) {
    try {
      const executable = resolveCli(command);
      if (executable && executable !== command && existsSync(executable)) {
        clients.push(...extractGoogleOAuthClients(readFileSync(executable)));
      }
    } catch {
      // Best-effort discovery from installed CLI binaries.
    }
  }
  discoveredOAuthClients = clients;
  return clients;
}

function oauthClientsForSource(source) {
  const configured = [];
  if (ANTIGRAVITY_OAUTH_CLIENT_ID && ANTIGRAVITY_OAUTH_CLIENT_SECRET) {
    configured.push({ clientId: ANTIGRAVITY_OAUTH_CLIENT_ID, clientSecret: ANTIGRAVITY_OAUTH_CLIENT_SECRET });
  }
  if (GEMINI_OAUTH_CLIENT_ID && GEMINI_OAUTH_CLIENT_SECRET) {
    configured.push({ clientId: GEMINI_OAUTH_CLIENT_ID, clientSecret: GEMINI_OAUTH_CLIENT_SECRET });
  }
  const discovered = discoverLocalOAuthClients();
  return source === "keychain" ? [...configured, ...discovered] : [...configured.reverse(), ...discovered];
}

async function refreshGoogleCredentials(credentials) {
  if (!credentials?.refresh_token) throw new Error(GOOGLE_SIGN_IN_MESSAGE);
  const clients = oauthClientsForSource(credentials.source).filter((c) => c.clientId && c.clientSecret);
  if (!clients.length) {
    throw new Error("Google token expired. Use the Gemini CLI or Antigravity once to refresh it.");
  }

  let data = null;
  for (const client of clients) {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "refresh_token",
        refresh_token: credentials.refresh_token,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.access_token) {
      data = body;
      break;
    }
  }
  if (!data?.access_token) throw new Error(GOOGLE_SIGN_IN_MESSAGE);

  const { id_token: _staleIdToken, source, rawParsed, filePath, ...restCredentials } = credentials;
  const refreshed = {
    ...restCredentials,
    source,
    access_token: data.access_token,
    expiry_date: Date.now() + (Number(data.expires_in || 3_600) * 1_000),
    ...(data.id_token ? { id_token: data.id_token } : {}),
  };

  if (source === "keychain") {
    writeAntigravityKeychainCredentials(rawParsed, refreshed);
  } else {
    try {
      const path = filePath || geminiCredentialsPath();
      const temporaryPath = `${path}.tmp`;
      const { source: _s, ...toWrite } = refreshed;
      writeFileSync(temporaryPath, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
      renameSync(temporaryPath, path);
    } catch {
      // The refreshed token still works for this session even if it cannot be persisted.
    }
  }
  return refreshed;
}

const getAccessTokenForCandidate = singleFlight(async (credentials) => {
  if (credentials.access_token && Number(credentials.expiry_date || 0) - 60_000 > Date.now()) {
    return credentials.access_token;
  }
  return (await refreshGoogleCredentials(credentials)).access_token;
});

function cloudCodePlatform() {
  if (process.platform === "darwin") return process.arch === "arm64" ? "DARWIN_ARM64" : "DARWIN_AMD64";
  if (process.platform === "win32") return "WINDOWS_AMD64";
  if (process.platform === "linux") return process.arch === "arm64" ? "LINUX_ARM64" : "LINUX_AMD64";
  return "PLATFORM_UNSPECIFIED";
}

async function cloudCodePost(url, accessToken, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_USER_AGENT,
    },
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

function mergeUniqueWindows(...windowLists) {
  const seen = new Set();
  const merged = [];
  for (const list of windowLists) {
    for (const item of list || []) {
      if (!item || !item.name || seen.has(item.name)) continue;
      seen.add(item.name);
      merged.push(item);
    }
  }
  return merged;
}

async function fetchGoogleQuotaWithToken(accessToken) {
  const platform = cloudCodePlatform();
  const [antigravityAssist, geminiAssist] = await Promise.all([
    cloudCodePost(CLOUD_CODE_LOAD_URL, accessToken, {
      metadata: { ideType: "ANTIGRAVITY", platform, pluginType: "GEMINI" },
    }).catch(() => null),
    cloudCodePost(CLOUD_CODE_LOAD_URL, accessToken, {
      metadata: { ideType: "GEMINI_CLI", platform, pluginType: "GEMINI" },
    }).catch(() => null),
  ]);
  const project = googleProjectId(antigravityAssist) || googleProjectId(geminiAssist);
  const requestBody = project ? { project } : {};

  const [quotaResult, summaryResult, modelsResult] = await Promise.allSettled([
    cloudCodePost(CLOUD_CODE_QUOTA_URL, accessToken, requestBody),
    CLOUD_CODE_QUOTA_SUMMARY_URL
      ? cloudCodePost(CLOUD_CODE_QUOTA_SUMMARY_URL, accessToken, requestBody)
      : Promise.reject(new Error("Quota summary URL not configured")),
    cloudCodePost(CLOUD_CODE_MODELS_URL, accessToken, requestBody),
  ]);

  const bucketWindows = quotaResult.status === "fulfilled" ? parseGoogleQuotaBuckets(quotaResult.value) : [];
  const summaryWindows = summaryResult.status === "fulfilled" ? parseGoogleQuotaSummary(summaryResult.value) : [];
  const modelWindows = modelsResult.status === "fulfilled" ? parseAntigravityModels(modelsResult.value) : [];
  const windows = (bucketWindows.length || summaryWindows.length)
    ? mergeUniqueWindows(bucketWindows, summaryWindows)
    : modelWindows;

  if (
    !windows.length
    && quotaResult.status === "rejected"
    && summaryResult.status === "rejected"
    && modelsResult.status === "rejected"
  ) {
    throw quotaResult.reason;
  }

  return {
    provider: "gemini",
    label: GOOGLE_LABEL,
    connected: true,
    plan: googlePlanLabel(antigravityAssist) || googlePlanLabel(geminiAssist),
    windows,
    updatedAt: new Date().toISOString(),
  };
}

async function loadGoogle() {
  const candidates = readGoogleCredentialCandidates();
  if (!candidates.length) throw notDetectedError("Gemini / Antigravity is not signed in on this device.");

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const accessToken = await getAccessTokenForCandidate(candidate);
      return await fetchGoogleQuotaWithToken(accessToken);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(GOOGLE_SIGN_IN_MESSAGE);
}

const gemini = {
  provider: "gemini",
  label: GOOGLE_LABEL,
  usagePageUrl: GEMINI_USAGE_PAGE_URL,
  load: loadGoogle,
  parseKeyringPayload,
};

module.exports = { gemini, loadGoogle, parseKeyringPayload };
