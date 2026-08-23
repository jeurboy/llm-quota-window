// Kimi: 5-hour and weekly windows from the Kimi Code CLI's /usages endpoint
// (with token refresh against auth.kimi.com), plus monthly membership quota
// from a separate kimi.com web sign-in granted by scanning a QR code with the
// Kimi mobile app.
const { app } = require("electron");
const { readFileSync, renameSync, rmSync, writeFileSync } = require("fs");
const { join } = require("path");
const { randomUUID } = require("crypto");
const QRCode = require("qrcode");
const {
  REQUEST_TIMEOUT_MS,
  KIMI_CLIENT_ID,
  KIMI_TOKEN_URL,
  KIMI_USAGE_URL,
  KIMI_USAGE_PAGE_URL,
  KIMI_MEMBERSHIP_STATS_URL,
  kimiCredentialsPath,
  PING_PROMPT,
  PING_TIMEOUT_MS,
} = require("../config");
const { runCli, resolveCli, cliInstalled, notDetectedError } = require("../cli");
const { dollars } = require("../format");
const { parseKimiUsagePayload, extractKimiClientId } = require("../kimi-usage");
const {
  createKimiLoginQr,
  getKimiLoginQrStatus,
  refreshKimiWebToken,
  kimiQrLoginUrl,
  parseMembershipStats,
} = require("../kimi-membership");
const { publish } = require("../bus");

function readKimiCredentials() {
  try {
    const credentials = JSON.parse(readFileSync(kimiCredentialsPath(), "utf8"));
    if (credentials?.access_token) return credentials;
  } catch {
    // Missing or unreadable credentials are reported as signed out below.
  }
  return null;
}

const KIMI_SIGN_IN_MESSAGE = "Kimi Code is signed out. Run `/login` in the Kimi Code CLI and refresh.";

// Resolved once per app session: the env override, or the public client id
// extracted from the installed Kimi Code CLI executable.
let discoveredKimiClientId = null;

function kimiClientId() {
  if (KIMI_CLIENT_ID) return KIMI_CLIENT_ID;
  if (!discoveredKimiClientId) {
    try {
      const executable = resolveCli("kimi");
      if (executable !== "kimi") discoveredKimiClientId = extractKimiClientId(readFileSync(executable));
    } catch {
      // Discovery is best-effort; the sign-in guidance below covers the rest.
    }
  }
  return discoveredKimiClientId;
}

async function refreshKimiCredentials(credentials) {
  const clientId = kimiClientId();
  if (!clientId) {
    throw new Error("Kimi token expired. Use the Kimi Code CLI once to refresh it (or set KIMI_CLIENT_ID).");
  }
  if (!credentials.refresh_token) throw new Error(KIMI_SIGN_IN_MESSAGE);
  const response = await fetch(KIMI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(
      response.status === 401 || response.status === 403 || data.error === "invalid_grant"
        ? KIMI_SIGN_IN_MESSAGE
        : `Kimi token refresh failed (${response.status}).`,
    );
  }
  const expiresIn = Number(data.expires_in ?? credentials.expires_in ?? 900);
  const refreshed = {
    ...credentials,
    access_token: data.access_token,
    refresh_token: data.refresh_token || credentials.refresh_token,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1_000) + expiresIn,
  };
  try {
    const path = kimiCredentialsPath();
    const temporaryPath = `${path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(refreshed, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, path);
  } catch {
    // The refreshed token still works for this session even if it cannot be persisted.
  }
  return refreshed;
}

async function getKimiCredentials() {
  const credentials = readKimiCredentials();
  if (!credentials) throw new Error(KIMI_SIGN_IN_MESSAGE);
  if (Number(credentials.expires_at || 0) - 60 > Date.now() / 1_000) return credentials;
  return refreshKimiCredentials(credentials);
}

// --- Kimi web (membership) session ---
// Kept apart from the CLI credentials: this is a separate kimi.com web login
// the user grants by scanning a QR code with the Kimi mobile app.
function kimiWebSessionPath() {
  return join(app.getPath("userData"), "kimi-web-session.json");
}

function readKimiWebSession() {
  try {
    const session = JSON.parse(readFileSync(kimiWebSessionPath(), "utf8"));
    return session && typeof session === "object" ? session : null;
  } catch {
    return null;
  }
}

function writeKimiWebSession(session) {
  const path = kimiWebSessionPath();
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(session, null, 2), { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function clearKimiWebSession() {
  try {
    rmSync(kimiWebSessionPath());
  } catch {
    // Already absent; nothing to clear.
  }
}

let kimiWebLoginPoll = null;

function stopWebLogin() {
  if (kimiWebLoginPoll) clearInterval(kimiWebLoginPoll);
  kimiWebLoginPoll = null;
}

async function startWebLogin() {
  stopWebLogin();
  const session = readKimiWebSession() || {};
  const deviceId = session.deviceId || randomUUID();
  if (!session.deviceId) writeKimiWebSession({ ...session, deviceId });
  const { code } = await createKimiLoginQr();
  const qrDataUrl = await QRCode.toDataURL(kimiQrLoginUrl(code, deviceId), { margin: 1, width: 256 });
  kimiWebLoginPoll = setInterval(async () => {
    try {
      const status = await getKimiLoginQrStatus(code);
      const state = String(status.status || "");
      if (state.endsWith("SCANNED")) publish("kimi:webLoginChanged", { status: "scanned" });
      if (state.endsWith("EXPIRED")) {
        stopWebLogin();
        publish("kimi:webLoginChanged", { status: "expired" });
      }
      if (!state.endsWith("SUCCESS")) return;
      stopWebLogin();
      if (status.accessToken && status.refreshToken) {
        writeKimiWebSession({
          deviceId,
          userId: status.userId || session.userId || null,
          accessToken: status.accessToken,
          refreshToken: status.refreshToken,
        });
      }
      publish("kimi:webLoginChanged", { status: "success" });
      publish("kimi:webSessionChanged");
    } catch {
      // Transient poll failures are ignored; the QR expires on its own.
    }
  }, 1_500);
  return { qrDataUrl };
}

async function signOutWeb() {
  stopWebLogin();
  clearKimiWebSession();
}

async function fetchKimiMembershipStats(accessToken) {
  return fetch(KIMI_MEMBERSHIP_STATS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "x-msh-platform": "web",
    },
    body: "{}",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function getKimiMonthlyWindow() {
  const session = readKimiWebSession();
  if (!session?.accessToken) return null;
  let response = await fetchKimiMembershipStats(session.accessToken);
  if (response.status === 401 && session.refreshToken) {
    const refreshed = await refreshKimiWebToken(session.refreshToken);
    if (refreshed.accessToken && refreshed.refreshToken) {
      writeKimiWebSession({ ...session, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken });
      response = await fetchKimiMembershipStats(refreshed.accessToken);
    }
  }
  if (response.status === 401) {
    // The web session was revoked; the card falls back to offering a new scan.
    clearKimiWebSession();
    return null;
  }
  if (!response.ok) return null;
  return parseMembershipStats(await response.json()).monthly;
}

async function load() {
  if (!readKimiCredentials() && !cliInstalled("kimi")) {
    throw notDetectedError("Kimi Code is not installed on this device.");
  }
  const credentials = await getKimiCredentials();
  const response = await fetch(KIMI_USAGE_URL, {
    headers: { Authorization: `Bearer ${credentials.access_token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? KIMI_SIGN_IN_MESSAGE : `Kimi usage request failed (${response.status}).`);
  }
  const { plan, windows, booster } = parseKimiUsagePayload(await response.json());
  // The monthly membership envelope needs the web sign-in above; when it is
  // available it supersedes the /usages totalQuota row for the same window.
  const monthly = await getKimiMonthlyWindow().catch(() => null);
  return {
    provider: "kimi",
    label: "Kimi",
    connected: true,
    plan,
    windows: monthly ? [...windows.filter((entry) => entry.name !== "Monthly limit"), monthly] : windows,
    webSignedIn: Boolean(readKimiWebSession()?.accessToken),
    creditSummary: booster
      ? `${dollars(booster.balanceCents / 100)} extra usage left · ${dollars(booster.monthlyUsedCents / 100)} spent this month`
      : undefined,
    updatedAt: new Date().toISOString(),
  };
}

function ping() {
  return runCli("kimi", ["-p", PING_PROMPT], { timeout: PING_TIMEOUT_MS });
}

module.exports = {
  provider: "kimi",
  label: "Kimi",
  usagePageUrl: KIMI_USAGE_PAGE_URL,
  load,
  ping,
  startWebLogin,
  stopWebLogin,
  signOutWeb,
};
