// Parsers for GitHub Copilot's internal usage endpoint, the same one editor
// integrations use for their status bar quota display.

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

// Copilot editor sign-ins land in apps.json (keyed "github.com:<client>") or
// the older hosts.json (keyed "github.com"); either holds the GitHub OAuth
// token the usage endpoint expects.
function extractCopilotToken(files) {
  for (const content of [files?.appsJson, files?.hostsJson]) {
    if (!content) continue;
    try {
      const parsed = JSON.parse(content);
      for (const [key, value] of Object.entries(parsed)) {
        if (key.startsWith("github.com") && typeof value?.oauth_token === "string" && value.oauth_token) {
          return value.oauth_token;
        }
      }
    } catch {
      // Try the next credential file.
    }
  }
  return null;
}

// quota_reset_date is usually a plain "yyyy-MM-dd"; normalise so the UI's
// countdown can parse it.
function normalizeResetDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
}

function toSnapshotWindow(snapshot, name, resetsAt) {
  if (!snapshot || typeof snapshot !== "object" || snapshot.unlimited) return null;
  const entitlement = Number(snapshot.entitlement);
  const remaining = Number(snapshot.remaining);
  let percentRemaining = Number(snapshot.percent_remaining);
  if (!Number.isFinite(percentRemaining)) {
    if (!Number.isFinite(entitlement) || entitlement <= 0 || !Number.isFinite(remaining)) return null;
    percentRemaining = (remaining / entitlement) * 100;
  }
  return {
    name,
    usedPercent: clampPercent(100 - percentRemaining),
    durationMinutes: null,
    resetsAt,
  };
}

function parseCopilotUsage(payload) {
  if (!payload || typeof payload !== "object") return { plan: null, windows: [] };
  const resetsAt = normalizeResetDate(payload.quota_reset_date);
  const snapshots = payload.quota_snapshots && typeof payload.quota_snapshots === "object" ? payload.quota_snapshots : {};
  const windows = [
    toSnapshotWindow(snapshots.premium_interactions, "Premium requests", resetsAt),
    toSnapshotWindow(snapshots.chat, "Chat", resetsAt),
  ].filter(Boolean);

  // Free plans report plain monthly counters instead of quota snapshots.
  if (!windows.length) {
    const monthly = payload.monthly_quotas;
    const limited = payload.limited_user_quotas;
    for (const [key, label] of [["chat", "Chat"], ["completions", "Completions"]]) {
      const limit = Number(monthly?.[key]);
      const left = Number(limited?.[key]);
      if (Number.isFinite(limit) && limit > 0 && Number.isFinite(left)) {
        windows.push({
          name: label,
          usedPercent: clampPercent(100 - (Math.max(0, left) / limit) * 100),
          durationMinutes: null,
          resetsAt,
        });
      }
    }
  }

  const plan = typeof payload.copilot_plan === "string" && payload.copilot_plan
    ? payload.copilot_plan.charAt(0).toUpperCase() + payload.copilot_plan.slice(1)
    : null;
  return { plan, windows };
}

module.exports = { extractCopilotToken, parseCopilotUsage };
