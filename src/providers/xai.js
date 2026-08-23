// xAI: prepaid API credits from the Management API, and SuperGrok subscription
// usage via the Grok CLI's stored sign-in.
const { readFileSync } = require("fs");
const {
  REQUEST_TIMEOUT_MS,
  XAI_MANAGEMENT_KEY,
  XAI_TEAM_ID,
  XAI_MANAGEMENT_API_URL,
  XAI_API_USAGE_PAGE_URL,
  GROK_CLI_BILLING_URL,
  GROK_USAGE_PAGE_URL,
  grokCredentialsPath,
} = require("../config");
const { notDetectedError } = require("../cli");
const { dollars } = require("../format");

function findGrokCredentials(value, candidates = []) {
  if (!value || typeof value !== "object") return candidates;
  if (typeof value.key === "string") candidates.push(value);
  for (const child of Object.values(value)) findGrokCredentials(child, candidates);
  return candidates;
}

function readGrokCredentials() {
  try {
    const candidates = findGrokCredentials(JSON.parse(readFileSync(grokCredentialsPath(), "utf8")));
    const now = Date.now();
    return candidates
      .filter((candidate) => !candidate.expires_at || new Date(candidate.expires_at).getTime() > now)
      .sort((left, right) => new Date(right.expires_at || 0).getTime() - new Date(left.expires_at || 0).getTime())[0] || null;
  } catch {
    return null;
  }
}

async function loadXaiApi() {
  if (!XAI_MANAGEMENT_KEY || !XAI_TEAM_ID) {
    throw notDetectedError("Set XAI_MANAGEMENT_KEY and XAI_TEAM_ID to monitor xAI API credits.");
  }
  const response = await fetch(`${XAI_MANAGEMENT_API_URL}/v1/billing/teams/${encodeURIComponent(XAI_TEAM_ID)}/prepaid/balance`, {
    headers: { Authorization: `Bearer ${XAI_MANAGEMENT_KEY}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error("xAI Management key was rejected. Check its Billing read permission.");
  if (!response.ok) throw new Error(`xAI credit balance request failed (${response.status}).`);
  const balance = await response.json();
  const cents = Math.abs(Number(balance.total?.val || 0));
  return {
    provider: "xai-api",
    label: "xAI API",
    connected: true,
    plan: "API credits",
    windows: [],
    creditSummary: `${dollars(cents / 100)} prepaid credits available`,
    updatedAt: new Date().toISOString(),
  };
}

async function loadSuperGrok() {
  const credentials = readGrokCredentials();
  if (!credentials?.key) throw notDetectedError("Grok CLI is not signed in. Run `grok login` to monitor SuperGrok usage.");
  const response = await fetch(GROK_CLI_BILLING_URL, {
    headers: {
      Authorization: `Bearer ${credentials.key}`,
      "x-xai-token-auth": "xai-grok-cli",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error("SuperGrok sign-in expired. Run `grok login` and refresh.");
  if (!response.ok) throw new Error(`SuperGrok usage request failed (${response.status}).`);
  const billing = await response.json();
  const config = billing.config || billing;
  const onDemandUsed = Number(config.onDemandUsed?.val || billing.onDemandUsed?.val || 0);
  const onDemandCap = Number(config.onDemandCap?.val || billing.onDemandCap?.val || 0);
  const directPercent = Number(config.creditUsagePercent ?? billing.creditUsagePercent);
  const usedPercent = Number.isFinite(directPercent) ? directPercent
    : onDemandCap > 0 ? 100 * onDemandUsed / onDemandCap : 0;
  const resetsAt = config.currentPeriod?.end || config.billingPeriodEnd || billing.billingPeriodEnd || null;
  return {
    provider: "supergrok",
    label: "SuperGrok",
    connected: true,
    plan: credentials.auth_mode || "Subscription",
    windows: [{ name: "Subscription usage", usedPercent: Math.max(0, Math.min(100, usedPercent)), durationMinutes: null, resetsAt }],
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  xaiApi: { provider: "xai-api", label: "xAI API", usagePageUrl: XAI_API_USAGE_PAGE_URL, load: loadXaiApi },
  supergrok: { provider: "supergrok", label: "SuperGrok", usagePageUrl: GROK_USAGE_PAGE_URL, load: loadSuperGrok },
};
