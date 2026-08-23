// Z.ai: Coding Plan quota windows and subscription plan, keyed by an API key,
// a Claude Code settings override, or the ZCode CLI login.
const { readFileSync } = require("fs");
const {
  REQUEST_TIMEOUT_MS,
  ZAI_API_KEY,
  ZAI_QUOTA_URL,
  ZAI_SUBSCRIPTION_URL,
  ZAI_USAGE_PAGE_URL,
  zaiSettingsPaths,
  zcodeCredentialsPath,
} = require("../config");
const { notDetectedError } = require("../cli");
const { extractZcodeZaiToken } = require("../zcode-credentials");

function zaiDurationMinutes(limit) {
  const units = { 3: 60, 4: 1_440, 5: 43_200, 6: 10_080 };
  const duration = Number(units[limit.unit]) * Number(limit.number || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function zaiResetTime(limit) {
  const epoch = Number(limit.nextResetTime);
  return Number.isFinite(epoch) && epoch > 0 ? new Date(epoch).toISOString() : null;
}

function readZaiApiKey() {
  if (ZAI_API_KEY) return ZAI_API_KEY;
  for (const settingsPath of zaiSettingsPaths()) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const baseUrl = String(settings.env?.ANTHROPIC_BASE_URL || "");
      const key = settings.env?.ANTHROPIC_AUTH_TOKEN;
      if (/^https:\/\/api\.z\.ai\//.test(baseUrl) && typeof key === "string" && key) return key;
    } catch {
      // Z.ai is optional; continue to the next local Claude Code settings file.
    }
  }
  try {
    const zcodeToken = extractZcodeZaiToken({ credentialsJson: readFileSync(zcodeCredentialsPath(), "utf8") });
    if (zcodeToken) return zcodeToken;
  } catch {
    // ZCode is optional; its credential store only exists after a Z.ai login.
  }
  return null;
}

async function load() {
  const apiKey = readZaiApiKey();
  if (!apiKey) throw notDetectedError("Set ZAI_API_KEY, configure Z.ai in Claude Code, or log in to Z.ai in ZCode to monitor its Coding Plan usage.");
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  const [quotaResult, subscriptionResult] = await Promise.allSettled([
    fetch(ZAI_QUOTA_URL, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    fetch(ZAI_SUBSCRIPTION_URL, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  ]);
  if (quotaResult.status === "rejected") throw quotaResult.reason;
  const quotaResponse = quotaResult.value;
  if (quotaResponse.status === 401 || quotaResponse.status === 403) throw new Error("Z.ai API key was rejected. Create a new key and refresh.");
  if (!quotaResponse.ok) throw new Error(`Z.ai quota request failed (${quotaResponse.status}).`);
  const quota = await quotaResponse.json();
  if (quota.success === false && /coding plan/i.test(quota.msg || "")) {
    throw notDetectedError("No active Z.ai Coding Plan was found for this API key.");
  }
  const limits = Array.isArray(quota.data?.limits) ? quota.data.limits : [];
  const windows = limits.flatMap((limit) => {
    const durationMinutes = zaiDurationMinutes(limit);
    if (["CREDIT_LIMIT", "TOKENS_LIMIT"].includes(limit.type) && durationMinutes) {
      return [{
        name: durationMinutes < 1_440 ? "5-hour limit" : "Weekly limit",
        usedPercent: Math.max(0, Math.min(100, Number(limit.percentage || 0))),
        durationMinutes,
        resetsAt: zaiResetTime(limit),
      }];
    }
    if (limit.type === "TIME_LIMIT") {
      const allowance = Number(limit.usage || 0);
      const used = Number(limit.currentValue || 0);
      if (!Number.isFinite(allowance) || allowance <= 0 || !Number.isFinite(used)) return [];
      return [{
        name: "Web search / reader",
        usedPercent: Math.max(0, Math.min(100, 100 * used / allowance)),
        durationMinutes: durationMinutes || 43_200,
        resetsAt: zaiResetTime(limit),
      }];
    }
    return [];
  });
  const plan = subscriptionResult.status === "fulfilled" && subscriptionResult.value.ok
    ? (await subscriptionResult.value.json()).data?.find((entry) => entry?.productName)?.productName || null
    : null;
  if (!windows.length) throw new Error("Z.ai returned no usable Coding Plan quota windows for this API key.");
  return {
    provider: "zai",
    label: "Z.ai",
    connected: true,
    plan,
    windows,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { provider: "zai", label: "Z.ai", usagePageUrl: ZAI_USAGE_PAGE_URL, load };
