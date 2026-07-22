function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function usedPercent(used, limit) {
  if (!limit || limit <= 0 || used === null) return 0;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function usedFrom(detail) {
  const used = toCount(detail?.used);
  if (used !== null) return used;
  const limit = toCount(detail?.limit);
  const remaining = toCount(detail?.remaining);
  return limit !== null && remaining !== null ? limit - remaining : null;
}

function windowDurationMinutes(window) {
  const duration = toCount(window?.duration);
  const unit = String(window?.timeUnit || "");
  if (!duration || duration <= 0) return null;
  if (unit.includes("MINUTE")) return duration;
  if (unit.includes("HOUR")) return duration * 60;
  if (unit.includes("DAY")) return duration * 1_440;
  return null;
}

function limitWindowName(durationMinutes) {
  if (!durationMinutes) return "Rate limit";
  if (durationMinutes >= 1_440 && durationMinutes % 1_440 === 0) return `${durationMinutes / 1_440}-day limit`;
  if (durationMinutes >= 60 && durationMinutes % 60 === 0) return `${durationMinutes / 60}-hour limit`;
  return `${durationMinutes}-minute limit`;
}

function toLimitWindow(item) {
  const detail = item?.detail && typeof item.detail === "object" ? item.detail : item;
  const limit = toCount(detail?.limit);
  const used = usedFrom(detail);
  if (used === null && limit === null) return null;
  const durationMinutes = windowDurationMinutes(item?.window);
  return {
    name: typeof detail?.name === "string" ? detail.name : limitWindowName(durationMinutes),
    usedPercent: usedPercent(used ?? 0, limit ?? 0),
    durationMinutes,
    resetsAt: typeof detail?.resetTime === "string" ? detail.resetTime : null,
  };
}

function membershipLabel(level) {
  if (typeof level !== "string" || !level) return null;
  const cleaned = level.replace(/^LEVEL_/i, "").toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function parseKimiUsagePayload(payload) {
  if (!payload || typeof payload !== "object") return { plan: null, windows: [] };
  const windows = [];
  for (const item of Array.isArray(payload.limits) ? payload.limits : []) {
    const window = toLimitWindow(item);
    if (window) windows.push(window);
  }
  const weekly = payload.usage;
  if (weekly && typeof weekly === "object") {
    const limit = toCount(weekly.limit);
    const used = usedFrom(weekly);
    if (used !== null || limit !== null) {
      windows.push({
        name: "Weekly limit",
        usedPercent: usedPercent(used ?? 0, limit ?? 0),
        durationMinutes: 10_080,
        resetsAt: typeof weekly.resetTime === "string" ? weekly.resetTime : null,
      });
    }
  }
  return {
    plan: membershipLabel(payload.user?.membership?.level),
    windows,
  };
}

module.exports = { parseKimiUsagePayload };
