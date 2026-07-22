import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseKimiUsagePayload, extractKimiClientId } = require("../src/kimi-usage.js");

const samplePayload = {
  user: { userId: "abc", region: "REGION_OVERSEA", membership: { level: "LEVEL_BASIC" } },
  usage: { limit: "100", used: "4", remaining: "96", resetTime: "2026-07-29T08:25:06.565102Z" },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      detail: { limit: "100", used: "21", remaining: "79", resetTime: "2026-07-22T13:25:06.565102Z" },
    },
  ],
};

test("parses the 5-hour window and weekly limit from a Kimi usages payload", () => {
  const { plan, windows } = parseKimiUsagePayload(samplePayload);
  assert.equal(plan, "Basic");
  assert.equal(windows.length, 2);

  const [fiveHour, weekly] = windows;
  assert.equal(fiveHour.name, "5-hour limit");
  assert.equal(fiveHour.durationMinutes, 300);
  assert.equal(fiveHour.usedPercent, 21);
  assert.equal(fiveHour.resetsAt, "2026-07-22T13:25:06.565102Z");

  assert.equal(weekly.name, "Weekly limit");
  assert.equal(weekly.durationMinutes, 10_080);
  assert.equal(weekly.usedPercent, 4);
  assert.equal(weekly.resetsAt, "2026-07-29T08:25:06.565102Z");
});

test("derives used quota from remaining when used is missing", () => {
  const { windows } = parseKimiUsagePayload({
    usage: { limit: 100, remaining: 40 },
  });
  assert.equal(windows[0].usedPercent, 60);
});

test("handles an empty or malformed payload", () => {
  assert.deepEqual(parseKimiUsagePayload(null), { plan: null, windows: [] });
  assert.deepEqual(parseKimiUsagePayload({}), { plan: null, windows: [] });
  assert.deepEqual(parseKimiUsagePayload({ limits: [{ window: {}, detail: {} }] }), { plan: null, windows: [] });
});

test("extracts the CLI's embedded OAuth client id from executable bytes", () => {
  const id = "17e5f671-d194-4dfb-9706-5516cb48c098";
  const binary = Buffer.concat([
    Buffer.from([0x00, 0xff, 0x90]),
    Buffer.from(`oauthHost:"https://auth.kimi.com",clientId: "${id}"`, "utf8"),
    Buffer.from([0x00, 0x1b]),
  ]);
  assert.equal(extractKimiClientId(binary), id);
  assert.equal(extractKimiClientId(Buffer.from("no ids here")), null);
  assert.equal(extractKimiClientId(null), null);
});

test("ignores limits without window duration units it understands", () => {
  const { windows } = parseKimiUsagePayload({
    limits: [
      { window: { duration: 30, timeUnit: "TIME_UNIT_SECOND" }, detail: { limit: 10, used: 5 } },
      { window: { duration: 2, timeUnit: "TIME_UNIT_HOUR" }, detail: { limit: 10, used: 5 } },
    ],
  });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].name, "Rate limit");
  assert.equal(windows[0].durationMinutes, null);
  assert.equal(windows[1].name, "2-hour limit");
  assert.equal(windows[1].durationMinutes, 120);
});
