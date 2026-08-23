// Groq: request rate limits surfaced as headers on the models endpoint.
const {
  REQUEST_TIMEOUT_MS,
  GROQ_API_KEY,
  GROQ_MODELS_URL,
  GROQ_USAGE_PAGE_URL,
} = require("../config");
const { notDetectedError } = require("../cli");
const { durationFromRateLimit } = require("../format");

async function load() {
  if (!GROQ_API_KEY) throw notDetectedError("Set GROQ_API_KEY to monitor Groq rate limits.");
  const response = await fetch(GROQ_MODELS_URL, {
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error("Groq API key was rejected. Create a key in Groq Console and refresh.");
  if (!response.ok) throw new Error(`Groq limits request failed (${response.status}).`);
  const limit = Number(response.headers.get("x-ratelimit-limit-requests"));
  const remaining = Number(response.headers.get("x-ratelimit-remaining-requests"));
  const resetsAt = durationFromRateLimit(response.headers.get("x-ratelimit-reset-requests"));
  return {
    provider: "groq",
    label: "Groq",
    connected: true,
    plan: "API rate limits",
    windows: Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)
      ? [{ name: "Requests", usedPercent: Math.max(0, Math.min(100, 100 * (1 - remaining / limit))), durationMinutes: null, resetsAt }]
      : [],
    creditSummary: "Rate-limit data from Groq response headers",
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { provider: "groq", label: "Groq", usagePageUrl: GROQ_USAGE_PAGE_URL, load };
