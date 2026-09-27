// OpenAI API: organization spend this month from the Admin API.
const {
  REQUEST_TIMEOUT_MS,
  OPENAI_ADMIN_KEY,
  OPENAI_COSTS_URL,
  OPENAI_API_USAGE_PAGE_URL,
} = require("../config");
const { notDetectedError } = require("../cli");
const { dollars, monthStartIso } = require("../format");

async function load() {
  if (!OPENAI_ADMIN_KEY) throw notDetectedError("Set OPENAI_ADMIN_KEY to monitor OpenAI API costs.");
  const url = new URL(OPENAI_COSTS_URL);
  url.searchParams.set("start_time", String(Math.floor(new Date(monthStartIso()).getTime() / 1_000)));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "31");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${OPENAI_ADMIN_KEY}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error("OpenAI Admin key was rejected. An Organization Owner must create one.");
  if (!response.ok) throw new Error(`OpenAI costs request failed (${response.status}).`);
  const payload = await response.json();
  const spent = (payload.data || []).flatMap((bucket) => bucket.results || [])
    .reduce((total, result) => total + Number(result.amount?.value || 0), 0);
  return {
    provider: "openai-api",
    label: "OpenAI API",
    connected: true,
    plan: "Organization API",
    windows: [],
    creditSummary: `${dollars(spent)} spent this month`,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { provider: "openai-api", label: "OpenAI API", usagePageUrl: OPENAI_API_USAGE_PAGE_URL, usesApiKey: true, load };
