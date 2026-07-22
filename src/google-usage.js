// Parsers for Google's Cloud Code private API, which backs both the Gemini CLI
// and Antigravity. Values arrive as proto3 JSON, so zero-valued fields (for
// example an exhausted remainingFraction) are omitted entirely.

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function bucketTier(modelId) {
  const id = String(modelId).toLowerCase();
  if (id.includes("flash-lite")) return "flashLite";
  if (id.includes("flash")) return "flash";
  if (id.includes("pro")) return "pro";
  return "other";
}

const TIER_ORDER = ["pro", "flash", "flashLite", "other"];
const TIER_LABELS = {
  pro: "Pro models",
  flash: "Flash models",
  flashLite: "Flash-Lite models",
  other: "Other models",
};

// Groups per-model quota buckets into Pro/Flash tiers, keeping the most-used
// model of each tier. Buckets reset every 24 hours.
function parseGoogleQuotaBuckets(payload) {
  const buckets = Array.isArray(payload?.buckets) ? payload.buckets : [];
  const tiers = new Map();
  for (const bucket of buckets) {
    if (!bucket || typeof bucket.modelId !== "string" || !bucket.modelId) continue;
    const fraction = Number(bucket.remainingFraction);
    const remainingFraction = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    const tier = bucketTier(bucket.modelId);
    const existing = tiers.get(tier);
    if (!existing || remainingFraction < existing.remainingFraction) {
      tiers.set(tier, {
        remainingFraction,
        resetsAt: typeof bucket.resetTime === "string" ? bucket.resetTime : null,
      });
    }
  }
  const windows = [];
  for (const tier of TIER_ORDER) {
    const entry = tiers.get(tier);
    if (!entry) continue;
    if (tier === "other" && windows.length) continue;
    windows.push({
      name: TIER_LABELS[tier],
      usedPercent: clampPercent((1 - entry.remainingFraction) * 100),
      durationMinutes: 1_440,
      resetsAt: entry.resetsAt,
    });
  }
  return windows;
}

// Antigravity's fetchAvailableModels returns a map of models with their own
// quotaInfo. Reset cadence is not reported, so durationMinutes stays null.
function parseAntigravityModels(payload) {
  const models = payload?.models && typeof payload.models === "object" ? payload.models : {};
  const windows = [];
  for (const [modelId, model] of Object.entries(models)) {
    const info = model?.quotaInfo;
    if (!info || typeof info !== "object") continue;
    const fraction = Number(info.remainingFraction);
    const remainingFraction = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    windows.push({
      name: model.displayName || model.label || modelId,
      usedPercent: clampPercent((1 - remainingFraction) * 100),
      durationMinutes: null,
      resetsAt: typeof info.resetTime === "string" ? info.resetTime : null,
    });
  }
  return windows.sort((a, b) => a.name.localeCompare(b.name));
}

const TIER_ID_LABELS = {
  "free-tier": "Free",
  "legacy-tier": "Legacy",
  "standard-tier": "Standard",
};

function googlePlanLabel(loadCodeAssistResponse) {
  const planType = loadCodeAssistResponse?.planInfo?.planType;
  if (typeof planType === "string" && planType.trim()) {
    const cleaned = planType.replace(/[_-]+/g, " ").trim().toLowerCase();
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  const tierId = loadCodeAssistResponse?.currentTier?.id;
  if (TIER_ID_LABELS[tierId]) return TIER_ID_LABELS[tierId];
  const tierName = loadCodeAssistResponse?.currentTier?.name;
  return typeof tierName === "string" && tierName ? tierName : null;
}

function googleProjectId(loadCodeAssistResponse) {
  const project = loadCodeAssistResponse?.cloudaicompanionProject;
  if (typeof project === "string" && project.trim()) return project.trim();
  const nested = project?.id ?? project?.projectId;
  return typeof nested === "string" && nested.trim() ? nested.trim() : null;
}

module.exports = { parseGoogleQuotaBuckets, parseAntigravityModels, googlePlanLabel, googleProjectId };
