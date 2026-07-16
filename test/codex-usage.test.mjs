import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectCodexDailyUsageBucket } = require("../src/codex-usage.js");

test("uses the current Codex usage bucket when it exists", () => {
  const result = selectCodexDailyUsageBucket([
    { startDate: "2026-07-15", tokens: 42 },
    { startDate: "2026-07-16", tokens: 99 },
  ], "2026-07-16");
  assert.deepEqual(result, { bucket: { startDate: "2026-07-16", tokens: 99 }, isToday: true });
});

test("falls back to the most recent completed Codex usage bucket", () => {
  const result = selectCodexDailyUsageBucket([
    { startDate: "2026-07-08", tokens: 8 },
    { startDate: "2026-07-15", tokens: 15 },
  ], "2026-07-16");
  assert.deepEqual(result, { bucket: { startDate: "2026-07-15", tokens: 15 }, isToday: false });
});
