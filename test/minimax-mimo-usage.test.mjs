import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.MINIMAX_API_KEY = "test-subscription-key";
const { usedPercent, load: loadMiniMax } = require("../src/providers/minimax.js");
const { parseUsage } = require("../src/providers/mimo.js");

test("MiniMax translates remaining quota to used percentage", () => {
  assert.equal(usedPercent({ current_interval_remaining_percent: 76 }, "current_interval"), 24);
  assert.equal(usedPercent({ current_weekly_total_count: 1000, current_weekly_usage_count: 650 }, "current_weekly"), 35);
  assert.equal(usedPercent({}, "current_interval"), null);
});

test("MiniMax fetches the documented Token Plan endpoint without calling a model", async () => {
  const fetchBefore = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    return {
      ok: true,
      json: async () => ({ model_remains: [{
        model_name: "general",
        current_interval_remaining_percent: 80,
        current_weekly_remaining_percent: 60,
        end_time: 1_780_000_000_000,
        weekly_end_time: 1_780_100_000_000,
      }] }),
    };
  };
  try {
    const result = await loadMiniMax();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://www.minimax.io/v1/token_plan/remains");
    assert.equal(calls[0].authorization, "Bearer test-subscription-key");
    assert.deepEqual(result.windows.map((window) => window.usedPercent), [20, 40]);
  } finally {
    global.fetch = fetchBefore;
  }
});

test("MiMo maps console usage to the current plan window", () => {
  const usage = { code: 0, data: { monthUsage: { items: [
    { name: "Token Plan", used: 25, limit: 100, percent: 25 },
  ] } } };
  const detail = { code: 0, data: { currentPeriodEnd: "2026-10-01 00:00:00" } };
  assert.deepEqual(parseUsage(usage, detail), [{
    name: "Token Plan",
    usedPercent: 25,
    durationMinutes: 43_200,
    resetsAt: "2026-10-01T00:00:00.000Z",
  }]);
  assert.equal(parseUsage({ code: 401 }, detail), null);
  assert.equal(parseUsage({ code: 0, data: { monthUsage: { items: [] } } }, detail), null);
});

test("MiMo sizes the plan window from the reported period when available", () => {
  const usage = { code: 0, data: { monthUsage: { items: [
    { name: "Token Plan", used: 25, limit: 100, percent: 25 },
  ] } } };
  const detail = { code: 0, data: {
    currentPeriodStart: "2026-08-01 00:00:00",
    currentPeriodEnd: "2026-09-01 00:00:00",
  } };
  assert.equal(parseUsage(usage, detail)[0].durationMinutes, 44_640);
});
