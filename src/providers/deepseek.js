// DeepSeek: prepaid API credit balance from the user balance endpoint.
// The API key is read from DEEPSEEK_API_KEY first; if unset, the app falls
// back to the key saved in the Providers panel (stored locally on this device).
const {
  REQUEST_TIMEOUT_MS,
  DEEPSEEK_API_KEY,
  DEEPSEEK_BALANCE_URL,
  DEEPSEEK_USAGE_PAGE_URL,
} = require("../config");
const { notDetectedError } = require("../cli");
const { getApiKey } = require("../api-keys");
const { dollars } = require("../format");

function readDeepSeekApiKey() {
  if (DEEPSEEK_API_KEY) return DEEPSEEK_API_KEY;
  try {
    return getApiKey("deepseek");
  } catch {
    return null;
  }
}

function needsApiKeyError(message) {
  const error = notDetectedError(message);
  error.needsApiKey = true;
  error.apiKeyProvider = "deepseek";
  return error;
}

async function load() {
  const apiKey = readDeepSeekApiKey();
  if (!apiKey) throw needsApiKeyError("Set DEEPSEEK_API_KEY or enter your DeepSeek API key in the Providers panel to monitor DeepSeek credits.");
  const response = await fetch(DEEPSEEK_BALANCE_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    throw needsApiKeyError("DeepSeek API key was rejected. Enter a valid key in the Providers panel.");
  }
  if (!response.ok) throw new Error(`DeepSeek balance request failed (${response.status}).`);
  const payload = await response.json();
  if (payload.is_available === false) throw notDetectedError("This DeepSeek account has no usable API credits.");
  const entries = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
  const total = entries.reduce((sum, entry) => sum + Number(entry.total_balance || 0), 0);
  const granted = entries.reduce((sum, entry) => sum + Number(entry.granted_balance || 0), 0);
  const toppedUp = entries.reduce((sum, entry) => sum + Number(entry.topped_up_balance || 0), 0);
  const remaining = Math.max(0, total);
  const currency = entries.find((entry) => entry.currency)?.currency || "USD";
  return {
    provider: "deepseek",
    label: "DeepSeek",
    connected: true,
    plan: "API credits",
    windows: total > 0 ? [{ name: "Credit balance", usedPercent: Math.min(100, 100 * (1 - remaining / total)), durationMinutes: null, resetsAt: null }] : [],
    creditSummary: currency.toUpperCase() === "USD"
      ? `${dollars(remaining)} credits remaining`
      : `${remaining.toFixed(2)} ${currency.toUpperCase()} credits remaining`,
    ...(granted || toppedUp ? { tokenUsage: { source: "Account top-up", dayLabel: "granted", dayTokens: granted, toppedUp } } : {}),
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { provider: "deepseek", label: "DeepSeek", usagePageUrl: DEEPSEEK_USAGE_PAGE_URL, usesApiKey: true, storesApiKey: true, load };
