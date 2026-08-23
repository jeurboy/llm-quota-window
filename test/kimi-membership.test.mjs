import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseMembershipStats, kimiQrLoginUrl } = require("../src/kimi-membership.js");

test("maps the subscription balance to a monthly window", () => {
  const { monthly } = parseMembershipStats({
    subscriptionBalance: { amountUsedRatio: 0.0305, expireTime: "2026-09-23T00:00:00Z" },
  });
  assert.deepEqual(monthly, {
    name: "Monthly limit",
    usedPercent: 3.05,
    durationMinutes: null,
    resetsAt: "2026-09-23T00:00:00Z",
  });
});

test("accepts proto field names and clamps out-of-range ratios", () => {
  const { monthly } = parseMembershipStats({
    subscription_balance: { amount_used_ratio: 1.4 },
  });
  assert.equal(monthly.usedPercent, 100);
  assert.equal(monthly.resetsAt, null);
});

test("returns no window without a usable subscription balance", () => {
  assert.equal(parseMembershipStats(null).monthly, null);
  assert.equal(parseMembershipStats({}).monthly, null);
  assert.equal(parseMembershipStats({ subscriptionBalance: {} }).monthly, null);
  assert.equal(parseMembershipStats({ subscriptionBalance: { amountUsedRatio: "n/a" } }).monthly, null);
});

test("builds the QR payload the Kimi app expects", () => {
  assert.equal(
    kimiQrLoginUrl("a b", "device/id"),
    "https://www.kimi.com/wechat/mp/auth?id=a%20b&device_id=device%2Fid",
  );
});
