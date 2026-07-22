import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extractCopilotToken, parseCopilotUsage } = require("../src/copilot-usage.js");

test("extracts the OAuth token from apps.json or hosts.json", () => {
  const appsJson = JSON.stringify({ "github.com:Iv1.abc123": { user: "dev", oauth_token: "ghu_apps" } });
  const hostsJson = JSON.stringify({ "github.com": { user: "dev", oauth_token: "ghu_hosts" } });
  assert.equal(extractCopilotToken({ appsJson }), "ghu_apps");
  assert.equal(extractCopilotToken({ hostsJson }), "ghu_hosts");
  assert.equal(extractCopilotToken({ appsJson, hostsJson }), "ghu_apps");
  assert.equal(extractCopilotToken({ appsJson: "not json" }), null);
  assert.equal(extractCopilotToken({}), null);
});

test("parses premium and chat quota snapshots", () => {
  const { plan, windows } = parseCopilotUsage({
    copilot_plan: "individual",
    quota_reset_date: "2026-08-01",
    quota_snapshots: {
      premium_interactions: { entitlement: 300, remaining: 210, percent_remaining: 70, unlimited: false },
      chat: { unlimited: true },
    },
  });
  assert.equal(plan, "Individual");
  assert.equal(windows.length, 1);
  assert.equal(windows[0].name, "Premium requests");
  assert.equal(windows[0].usedPercent, 30);
  assert.equal(windows[0].resetsAt, "2026-08-01T00:00:00Z");
});

test("derives percent from entitlement and remaining when percent is missing", () => {
  const { windows } = parseCopilotUsage({
    quota_snapshots: { premium_interactions: { entitlement: 500, remaining: 125 } },
  });
  assert.equal(windows[0].usedPercent, 75);
});

test("falls back to monthly counters for free plans", () => {
  const { windows } = parseCopilotUsage({
    copilot_plan: "free",
    monthly_quotas: { chat: 50, completions: 2000 },
    limited_user_quotas: { chat: 10, completions: 500 },
  });
  assert.deepEqual(windows.map((window) => [window.name, window.usedPercent]), [["Chat", 80], ["Completions", 75]]);
});

test("handles empty or malformed payloads", () => {
  assert.deepEqual(parseCopilotUsage(null), { plan: null, windows: [] });
  assert.deepEqual(parseCopilotUsage({}), { plan: null, windows: [] });
});
