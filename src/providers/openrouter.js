// OpenRouter: prepaid credit balance from the Management API.
const {
  REQUEST_TIMEOUT_MS,
  OPENROUTER_MANAGEMENT_KEY,
  OPENROUTER_CREDITS_URL,
  OPENROUTER_USAGE_PAGE_URL,
} = require("../config");
const { notDetectedError } = require("../cli");
const { dollars } = require("../format");

async function load() {
  if (!OPENROUTER_MANAGEMENT_KEY) throw notDetectedError("Set OPENROUTER_MANAGEMENT_KEY to monitor OpenRouter credits.");
  const response = await fetch(OPENROUTER_CREDITS_URL, {
    headers: { Authorization: `Bearer ${OPENROUTER_MANAGEMENT_KEY}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error("OpenRouter management key was rejected. Create a Management API key and refresh.");
  if (!response.ok) throw new Error(`OpenRouter credits request failed (${response.status}).`);
  const credits = (await response.json()).data || {};
  const total = Number(credits.total_credits || 0);
  const used = Number(credits.total_usage || 0);
  const remaining = Math.max(0, total - used);
  return {
    provider: "openrouter",
    label: "OpenRouter",
    connected: true,
    plan: "API credits",
    windows: total > 0 ? [{ name: "Credit balance", usedPercent: Math.min(100, 100 * used / total), durationMinutes: null, resetsAt: null }] : [],
    creditSummary: `${dollars(remaining)} credits remaining · ${dollars(used)} used`,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { provider: "openrouter", label: "OpenRouter", usagePageUrl: OPENROUTER_USAGE_PAGE_URL, usesApiKey: true, load };
