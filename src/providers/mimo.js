// MiMo exposes Token Plan usage through its signed-in console session.
// A tp- API key can list models, but cannot read the account's usage.
const { REQUEST_TIMEOUT_MS, MIMO_USAGE_PAGE_URL, MIMO_CONSOLE_API_BASE } = require("../config");

const SESSION_PARTITION = "persist:mimo-console";
const CONSOLE_ORIGIN = "https://platform.xiaomimimo.com";

function toIso(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    const date = new Date(number > 1e12 ? number : number * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const valueWithZone = /(?:Z|[+-]\d\d:\d\d)$/.test(String(value)) ? String(value) : `${String(value).replace(" ", "T")}Z`;
  const date = new Date(valueWithZone);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseUsage(payload, detail) {
  if (payload?.code !== 0) return null;
  const items = payload.data?.monthUsage?.items;
  if (!Array.isArray(items) || !items.length) return null;
  const periodEnd = detail?.code === 0 ? toIso(detail.data?.currentPeriodEnd) : null;
  const windows = items.flatMap((item) => {
    const used = Number(item.used);
    const limit = Number(item.limit);
    const percent = item.percent == null ? NaN : Number(item.percent);
    const usedPercent = Number.isFinite(used) && Number.isFinite(limit) && limit > 0
      ? 100 * used / limit
      : Number.isFinite(percent) ? percent : null;
    if (usedPercent === null) return [];
    return [{
      name: item.name || "Token Plan · monthly",
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
      durationMinutes: null,
      resetsAt: periodEnd,
    }];
  });
  return windows.length ? windows : null;
}

async function consoleCookies() {
  const { session } = require("electron");
  const cookies = await session.fromPartition(SESSION_PARTITION).cookies.get({ url: `${MIMO_CONSOLE_API_BASE}/tokenPlan/usage` });
  const names = new Set(cookies.map((cookie) => cookie.name));
  if (!names.has("api-platform_serviceToken") || !names.has("userId")) return null;
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function consoleGet(path, cookie) {
  const response = await fetch(`${MIMO_CONSOLE_API_BASE}/${path}`, {
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      Origin: CONSOLE_ORIGIN,
      Referer: `${CONSOLE_ORIGIN}/#/console/plan-manage`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function signInRequired(message) {
  return {
    provider: "mimo",
    label: "MiMo",
    connected: false,
    plan: "Token Plan",
    windows: [],
    needsWebLogin: true,
    creditSummary: message,
    updatedAt: new Date().toISOString(),
  };
}

async function load() {
  const cookie = await consoleCookies();
  if (!cookie) return signInRequired("Sign in to MiMo to read Token Plan usage.");
  try {
    const [usage, detail] = await Promise.all([
      consoleGet("tokenPlan/usage", cookie),
      consoleGet("tokenPlan/detail", cookie),
    ]);
    const windows = parseUsage(usage, detail);
    if (!windows) return signInRequired("MiMo did not return Token Plan usage. Sign in again or check the usage page.");
    return {
      provider: "mimo",
      label: "MiMo",
      connected: true,
      plan: detail?.code === 0 ? detail.data?.planCode || "Token Plan" : "Token Plan",
      windows,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return signInRequired("Could not read MiMo usage. Check your connection and refresh.");
  }
}

async function signOut() {
  const { session } = require("electron");
  await session.fromPartition(SESSION_PARTITION).clearStorageData({ storages: ["cookies", "localstorage"] });
}

module.exports = {
  provider: "mimo", label: "MiMo", usagePageUrl: MIMO_USAGE_PAGE_URL,
  usesApiKey: false, load, signOut, parseUsage, SESSION_PARTITION,
};
