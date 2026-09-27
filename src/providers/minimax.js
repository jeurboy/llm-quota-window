// MiniMax: pay-as-you-go balance from /account/query_balance, or Token Plan
// quota from /v1/token_plan/remains. The API key is read from MINIMAX_API_KEY
// first; if unset, the app falls back to the key saved in the Providers panel.
const {
  REQUEST_TIMEOUT_MS,
  MINIMAX_API_KEY,
  MINIMAX_BALANCE_URL,
  MINIMAX_TOKEN_PLAN_URL,
  MINIMAX_USAGE_PAGE_URL,
} = require("../config");
const { notDetectedError } = require("../cli");
const { getApiKey } = require("../api-keys");
const { dollars } = require("../format");

function readMiniMaxApiKey() {
  if (MINIMAX_API_KEY) return MINIMAX_API_KEY;
  try {
    return getApiKey("minimax");
  } catch {
    return null;
  }
}

function needsApiKeyError(message) {
  const error = notDetectedError(message);
  error.needsApiKey = true;
  error.apiKeyProvider = "minimax";
  return error;
}

// MiniMax timestamps are Unix seconds (or milliseconds in some responses).
function toIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function usedPercent(model, prefix) {
  const remainingPercent = Number(model[`${prefix}_remaining_percent`]);
  if (Number.isFinite(remainingPercent)) return Math.max(0, Math.min(100, 100 - remainingPercent));
  const total = Number(model[`${prefix}_total_count`]);
  const remaining = Number(model[`${prefix}_usage_count`]);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(remaining)) {
    return Math.max(0, Math.min(100, 100 * (total - remaining) / total));
  }
  return null;
}

// Pay-as-you-go accounts expose a cash/credit balance.
async function loadPayAsYouGo(apiKey) {
  const response = await fetch(MINIMAX_BALANCE_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (payload.base_resp && payload.base_resp.status_code !== 0) return null;
  const available = Number(payload.available_amount);
  const cash = Number(payload.cash_balance || 0);
  const credit = Number(payload.credit_balance || 0);
  const voucher = Number(payload.voucher_balance || 0);
  if (!Number.isFinite(available) || available < 0) return null;
  return {
    provider: "minimax",
    label: "MiniMax",
    connected: true,
    plan: "Pay-as-you-go",
    windows: [],
    creditSummary: `${dollars(available)} available · ${dollars(cash)} cash · ${dollars(credit)} credit · ${dollars(voucher)} voucher`,
    updatedAt: new Date().toISOString(),
  };
}

// Token Plan / subscription accounts expose per-model quota windows.
async function loadTokenPlan(apiKey) {
  const response = await fetch(MINIMAX_TOKEN_PLAN_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (payload.base_resp && payload.base_resp.status_code !== 0) return null;

  // The response has model_remains[] with per-model quota. Each entry has
  // current_interval_remaining_percent (5-hour window) and
  // current_weekly_remaining_percent (weekly window).
  const models = Array.isArray(payload.model_remains) ? payload.model_remains : [];
  if (!models.length) return null;

  const windows = [];
  for (const model of models) {
    const name = model.model_name || "Model quota";
    const intervalPct = usedPercent(model, "current_interval");
    const weeklyPct = usedPercent(model, "current_weekly");

    if (intervalPct !== null) {
      windows.push({
        name: `${name} · 5-hour`,
        usedPercent: intervalPct,
        durationMinutes: 300,
        resetsAt: toIso(model.end_time),
      });
    }
    if (weeklyPct !== null) {
      windows.push({
        name: `${name} · weekly`,
        usedPercent: weeklyPct,
        durationMinutes: 10_080,
        resetsAt: toIso(model.weekly_end_time),
      });
    }
  }
  if (!windows.length) return null;

  return {
    provider: "minimax",
    label: "MiniMax",
    connected: true,
    plan: "Token Plan",
    windows,
    updatedAt: new Date().toISOString(),
  };
}

async function load() {
  const apiKey = readMiniMaxApiKey();
  if (!apiKey) throw needsApiKeyError("Set MINIMAX_API_KEY or enter your MiniMax API key in the Providers panel to monitor MiniMax credits.");

  // Subscription keys use the documented Token Plan endpoint.
  try {
    const plan = await loadTokenPlan(apiKey);
    if (plan) return plan;
  } catch {
    // The key may belong to a pay-as-you-go account.
  }

  try {
    const payg = await loadPayAsYouGo(apiKey);
    if (payg) return payg;
  } catch {
    // Keep the missing-usage state below.
  }

  return {
    provider: "minimax",
    label: "MiniMax",
    connected: false,
    plan: null,
    windows: [],
    creditSummary: "No quota or balance was returned. Check that this is the Subscription Key for your Token Plan, or view usage on MiniMax.",
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { provider: "minimax", label: "MiniMax", usagePageUrl: MINIMAX_USAGE_PAGE_URL, usesApiKey: true, storesApiKey: true, load, usedPercent };
