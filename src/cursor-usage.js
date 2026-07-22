const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const TOKEN_SCAN_RANGE = 4_096;

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// Cursor keeps its OAuth access token in a VS Code-style SQLite store. The value
// bytes sit right after the ItemTable key inside each record, so a byte scan finds
// the JWT without needing a SQLite driver. Old pages and the WAL can hold stale
// copies, so every candidate is collected and the one expiring last wins.
function extractCursorSession(buffers, nowMs = Date.now()) {
  const candidates = new Map();
  for (const buffer of Array.isArray(buffers) ? buffers : [buffers]) {
    if (!buffer) continue;
    const text = buffer.toString("latin1");
    let searchFrom = 0;
    let keyIndex;
    while ((keyIndex = text.indexOf(ACCESS_TOKEN_KEY, searchFrom)) !== -1) {
      searchFrom = keyIndex + ACCESS_TOKEN_KEY.length;
      const match = text.slice(searchFrom, searchFrom + TOKEN_SCAN_RANGE).match(JWT_PATTERN);
      if (!match) continue;
      const accessToken = match[0];
      const payload = decodeJwtPayload(accessToken);
      const userId = typeof payload?.sub === "string" ? payload.sub.split("|").pop() : null;
      const expiresAtMs = Number(payload?.exp) * 1_000;
      if (!userId || !/^[A-Za-z0-9._-]+$/.test(userId)) continue;
      if (!Number.isFinite(expiresAtMs) || expiresAtMs < nowMs + 60_000) continue;
      candidates.set(accessToken, { accessToken, userId, expiresAtMs });
    }
  }
  let best = null;
  for (const candidate of candidates.values()) {
    if (!best || candidate.expiresAtMs > best.expiresAtMs) best = candidate;
  }
  return best;
}

function toCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function dollars(cents) {
  const usd = (cents ?? 0) / 100;
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

function billingCycleMinutes(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return Math.round((endMs - startMs) / 60_000);
}

// Headline percent precedence mirrors Cursor's own dashboard: the reported total,
// then the auto/API lane percents, then dollar ratios from whichever usage block
// (individual plan, enterprise personal cap, shared team pool) carries numbers.
function planPercentUsed(summary) {
  const plan = summary.individualUsage?.plan;
  const total = toCents(plan?.totalPercentUsed);
  if (total !== null) return total;
  const auto = toCents(plan?.autoPercentUsed);
  const api = toCents(plan?.apiPercentUsed);
  if (auto !== null && api !== null) return (auto + api) / 2;
  if (auto !== null || api !== null) return auto ?? api;
  for (const block of [plan, summary.individualUsage?.overall, summary.teamUsage?.pooled]) {
    const used = toCents(block?.used);
    const limit = toCents(block?.limit);
    if (used !== null && limit !== null && limit > 0) return (used / limit) * 100;
  }
  return null;
}

function membershipLabel(membershipType) {
  if (typeof membershipType !== "string" || !membershipType) return null;
  const cleaned = membershipType.replace(/[_-]+/g, " ").trim().toLowerCase();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : null;
}

function parseCursorUsageSummary(summary) {
  if (!summary || typeof summary !== "object") return { plan: null, windows: [] };
  const resetsAt = typeof summary.billingCycleEnd === "string" ? summary.billingCycleEnd : null;
  const durationMinutes = billingCycleMinutes(summary.billingCycleStart, summary.billingCycleEnd);
  const windows = [];

  const percent = planPercentUsed(summary);
  if (percent !== null) {
    const plan = summary.individualUsage?.plan;
    const limit = toCents(plan?.limit);
    windows.push({
      name: limit > 0 ? `Included usage · ${dollars(toCents(plan?.used))} of ${dollars(limit)}` : "Included usage",
      usedPercent: clampPercent(percent),
      durationMinutes,
      resetsAt,
    });
  }

  const onDemand = summary.individualUsage?.onDemand;
  const onDemandLimit = toCents(onDemand?.limit);
  if (onDemand?.enabled && onDemandLimit > 0) {
    const used = toCents(onDemand.used) ?? 0;
    windows.push({
      name: `On-demand · ${dollars(used)} of ${dollars(onDemandLimit)}`,
      usedPercent: clampPercent((used / onDemandLimit) * 100),
      durationMinutes,
      resetsAt,
    });
  }

  return { plan: membershipLabel(summary.membershipType), windows };
}

module.exports = { decodeJwtPayload, extractCursorSession, parseCursorUsageSummary };
