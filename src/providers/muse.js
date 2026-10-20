// Muse (Meta): request rate limits surfaced as headers on the models endpoint (OpenAI-compatible API).
const {
  REQUEST_TIMEOUT_MS,
  MUSE_API_KEY,
  MUSE_MODELS_URL,
  MUSE_USAGE_PAGE_URL,
} = require("../config");
const { notDetectedError } = require("../cli");
const { durationFromRateLimit } = require("../format");

async function load() {
  if (!MUSE_API_KEY) throw notDetectedError("Set MUSE_API_KEY to monitor Muse (Meta) rate limits.");
  const response = await fetch(MUSE_MODELS_URL, {
    headers: { Authorization: `Bearer ${MUSE_API_KEY}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error("Muse (Meta) API key was rejected. Create a key in Meta developer console and refresh.");
  if (!response.ok) throw new Error(`Muse (Meta) limits request failed (${response.status}).`);
  const limit = Number(response.headers.get("x-ratelimit-limit-requests"));
  const remaining = Number(response.headers.get("x-ratelimit-remaining-requests"));
  const resetsAt = durationFromRateLimit(response.headers.get("x-ratelimit-reset-requests"));
  return {
    provider: "muse",
    label: "Muse",
    connected: true,
    plan: "API rate limits",
    windows: Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)
      ? [{ name: "Requests", usedPercent: Math.max(0, Math.min(100, 100 * (1 - remaining / limit))), durationMinutes: null, resetsAt }]
      : [],
    creditSummary: "Rate-limit data from Muse (Meta) response headers",
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { provider: "muse", label: "Muse", usagePageUrl: MUSE_USAGE_PAGE_URL, usesApiKey: true, load };
