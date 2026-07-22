import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseGoogleQuotaBuckets,
  parseAntigravityModels,
  googlePlanLabel,
  googleProjectId,
} = require("../src/google-usage.js");

test("groups quota buckets into tier windows keeping the most-used model", () => {
  const windows = parseGoogleQuotaBuckets({
    buckets: [
      { modelId: "gemini-2.5-pro", remainingFraction: 0.9, resetTime: "2026-07-23T10:00:00Z" },
      { modelId: "gemini-3-pro-preview", remainingFraction: 0.4, resetTime: "2026-07-23T11:00:00Z" },
      { modelId: "gemini-2.5-flash", remainingFraction: 1, resetTime: "2026-07-23T10:00:00Z" },
      { modelId: "gemini-3.1-flash-lite", remainingFraction: 0.75, resetTime: "2026-07-23T10:00:00Z" },
    ],
  });
  assert.deepEqual(windows.map((window) => window.name), ["Pro models", "Flash models", "Flash-Lite models"]);
  const [pro, flash, flashLite] = windows;
  assert.equal(Math.round(pro.usedPercent), 60);
  assert.equal(pro.resetsAt, "2026-07-23T11:00:00Z");
  assert.equal(pro.durationMinutes, 1_440);
  assert.equal(flash.usedPercent, 0);
  assert.equal(flashLite.usedPercent, 25);
});

test("treats a missing remainingFraction as exhausted (proto3 omits zeros)", () => {
  const windows = parseGoogleQuotaBuckets({
    buckets: [{ modelId: "gemini-3-pro-preview", resetTime: "2026-07-23T10:00:00Z" }],
  });
  assert.equal(windows[0].usedPercent, 100);
});

test("handles empty or malformed bucket payloads", () => {
  assert.deepEqual(parseGoogleQuotaBuckets(null), []);
  assert.deepEqual(parseGoogleQuotaBuckets({}), []);
  assert.deepEqual(parseGoogleQuotaBuckets({ buckets: [{ remainingFraction: 1 }] }), []);
});

test("parses Antigravity model quotas sorted by display name", () => {
  const windows = parseAntigravityModels({
    models: {
      "gemini-3-pro": { displayName: "Gemini 3 Pro", quotaInfo: { remainingFraction: 0.5, resetTime: "2026-07-23T00:00:00Z" } },
      "claude-sonnet": { label: "Claude Sonnet", quotaInfo: { remainingFraction: 0.8 } },
      "no-quota-model": { displayName: "Hidden" },
    },
  });
  assert.deepEqual(windows.map((window) => window.name), ["Claude Sonnet", "Gemini 3 Pro"]);
  assert.ok(Math.abs(windows[0].usedPercent - 20) < 1e-9);
  assert.equal(windows[1].resetsAt, "2026-07-23T00:00:00Z");
});

test("resolves plan labels and project ids from loadCodeAssist responses", () => {
  assert.equal(googlePlanLabel({ currentTier: { id: "standard-tier" } }), "Standard");
  assert.equal(googlePlanLabel({ planInfo: { planType: "ULTRA_TIER" } }), "Ultra tier");
  assert.equal(googlePlanLabel(null), null);
  assert.equal(googleProjectId({ cloudaicompanionProject: "my-project" }), "my-project");
  assert.equal(googleProjectId({ cloudaicompanionProject: { id: "nested-id" } }), "nested-id");
  assert.equal(googleProjectId({}), null);
});
