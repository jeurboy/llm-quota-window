// Small formatting and date helpers shared across provider modules.

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function dollars(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function durationFromRateLimit(value) {
  const match = String(value || "").match(/(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?/);
  if (!match || !match[0]) return null;
  const milliseconds = ((Number(match[1]) || 0) * 3_600_000) + ((Number(match[2]) || 0) * 60_000) + ((Number(match[3]) || 0) * 1_000);
  return milliseconds ? new Date(Date.now() + milliseconds).toISOString() : null;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

module.exports = { monthStartIso, dollars, durationFromRateLimit, localDateKey };
