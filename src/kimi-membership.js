// Kimi's consumer web session (the one www.kimi.com uses) is required for
// monthly membership quota. It lives behind auth.kimi.com's account gateway
// and www.kimi.com's membership gateway, both of which speak Connect RPC
// (POST with a JSON body). The Kimi Code CLI token cannot cross these — it
// is signed for the coding gateway only — so the app offers a separate web
// sign-in: a QR code scanned by the Kimi mobile app, exactly like kimi.com.
const { KIMI_AUTH_RPC_BASE, KIMI_QR_LOGIN_URL } = require("./config");

async function callAuthRpc(method, body) {
  const response = await fetch(`${KIMI_AUTH_RPC_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-msh-platform": "web" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Kimi ${method} request failed (${response.status}).`);
  return data;
}

function createKimiLoginQr() {
  return callAuthRpc("CreateLoginQRCode", {});
}

function getKimiLoginQrStatus(code) {
  return callAuthRpc("GetLoginQRCodeStatus", { code });
}

function refreshKimiWebToken(refreshToken) {
  return callAuthRpc("RefreshToken", { refreshToken });
}

// The QR payload the Kimi app scans; the page it opens confirms the login
// server-side, which the status poll then observes as SUCCESS.
function kimiQrLoginUrl(code, deviceId) {
  return `${KIMI_QR_LOGIN_URL}?id=${encodeURIComponent(code)}&device_id=${encodeURIComponent(deviceId)}`;
}

// Connect servers emit lowerCamelCase JSON, but the web client requests proto
// field names, so accept either spelling.
function field(object, camelCase, snakeCase) {
  return object?.[camelCase] !== undefined ? object[camelCase] : object?.[snakeCase];
}

function parseMembershipStats(payload) {
  if (!payload || typeof payload !== "object") return { monthly: null };
  const balance = field(payload, "subscriptionBalance", "subscription_balance");
  if (!balance || typeof balance !== "object") return { monthly: null };
  const ratio = Number(field(balance, "amountUsedRatio", "amount_used_ratio"));
  if (!Number.isFinite(ratio)) return { monthly: null };
  const resetsAt = field(balance, "expireTime", "expire_time");
  return {
    monthly: {
      name: "Monthly limit",
      usedPercent: Math.max(0, Math.min(100, ratio * 100)),
      durationMinutes: null,
      resetsAt: typeof resetsAt === "string" ? resetsAt : null,
    },
  };
}

module.exports = { createKimiLoginQr, getKimiLoginQrStatus, refreshKimiWebToken, kimiQrLoginUrl, parseMembershipStats };
