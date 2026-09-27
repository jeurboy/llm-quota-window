// Anthropic API: organization token usage this month from the Admin API.
const {
  REQUEST_TIMEOUT_MS,
  ANTHROPIC_ADMIN_KEY,
  ANTHROPIC_USAGE_REPORT_URL,
  ANTHROPIC_API_USAGE_PAGE_URL,
  CLAUDE_API_VERSION,
} = require("../config");
const { notDetectedError } = require("../cli");
const { monthStartIso } = require("../format");

async function load() {
  if (!ANTHROPIC_ADMIN_KEY) throw notDetectedError("Set ANTHROPIC_ADMIN_KEY to monitor Anthropic API usage.");
  const url = new URL(ANTHROPIC_USAGE_REPORT_URL);
  url.searchParams.set("starting_at", monthStartIso());
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "31");
  const response = await fetch(url, {
    headers: { "x-api-key": ANTHROPIC_ADMIN_KEY, "anthropic-version": CLAUDE_API_VERSION },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error("Anthropic Admin key was rejected. Create one in the Anthropic Console.");
  if (!response.ok) throw new Error(`Anthropic usage request failed (${response.status}).`);
  const results = (await response.json()).data?.flatMap((bucket) => bucket.results || []) || [];
  const tokens = results.reduce((total, result) => total + Number(result.uncached_input_tokens || 0)
    + Number(result.cache_read_input_tokens || 0) + Number(result.output_tokens || 0)
    + Object.values(result.cache_creation || {}).reduce((sum, value) => sum + Number(value || 0), 0), 0);
  return {
    provider: "anthropic-api",
    label: "Anthropic API",
    connected: true,
    plan: "Organization API",
    windows: [],
    tokenUsage: { source: "API usage this month", dayLabel: "this month", dayTokens: tokens },
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { provider: "anthropic-api", label: "Anthropic API", usagePageUrl: ANTHROPIC_API_USAGE_PAGE_URL, usesApiKey: true, load };
