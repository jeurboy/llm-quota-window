import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { decodeJwtPayload, extractCursorSession, parseCursorUsageSummary } = require("../src/cursor-usage.js");

const NOW_MS = Date.parse("2026-07-22T10:00:00Z");

function makeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.c2lnbmF0dXJl`;
}

function makeStateDb(...records) {
  // Mimics SQLite record layout: the value bytes directly follow the key bytes.
  return Buffer.concat(records.flatMap(({ key, value }) => [
    Buffer.from([0x00, 0x17, 0x81]),
    Buffer.from(key, "utf8"),
    Buffer.from(value, "utf8"),
    Buffer.from([0x00, 0x00]),
  ]));
}

const validToken = makeJwt({ sub: "auth0|user_01HXAMPLE", exp: (NOW_MS / 1000) + 86_400 });

test("extracts the access token and user id from a state db byte scan", () => {
  const db = makeStateDb(
    { key: "cursorAuth/cachedEmail", value: "dev@example.com" },
    { key: "cursorAuth/accessToken", value: validToken },
  );
  const session = extractCursorSession(db, NOW_MS);
  assert.equal(session.accessToken, validToken);
  assert.equal(session.userId, "user_01HXAMPLE");
});

test("prefers the token that expires last when stale copies exist", () => {
  const older = makeJwt({ sub: "auth0|user_A", exp: (NOW_MS / 1000) + 3_600 });
  const newer = makeJwt({ sub: "auth0|user_A", exp: (NOW_MS / 1000) + 86_400 });
  const session = extractCursorSession([
    makeStateDb({ key: "cursorAuth/accessToken", value: newer }),
    makeStateDb({ key: "cursorAuth/accessToken", value: older }),
  ], NOW_MS);
  assert.equal(session.accessToken, newer);
});

test("returns null for expired tokens, missing keys, or malformed JWTs", () => {
  const expired = makeJwt({ sub: "auth0|user_A", exp: (NOW_MS / 1000) - 60 });
  assert.equal(extractCursorSession(makeStateDb({ key: "cursorAuth/accessToken", value: expired }), NOW_MS), null);
  assert.equal(extractCursorSession(makeStateDb({ key: "cursorAuth/refreshToken", value: validToken }), NOW_MS), null);
  assert.equal(extractCursorSession(makeStateDb({ key: "cursorAuth/accessToken", value: "not-a-jwt" }), NOW_MS), null);
  assert.equal(extractCursorSession(Buffer.alloc(0), NOW_MS), null);
});

test("decodes a JWT payload and rejects malformed tokens", () => {
  assert.equal(decodeJwtPayload(validToken).sub, "auth0|user_01HXAMPLE");
  assert.equal(decodeJwtPayload("only.two"), null);
});

const sampleSummary = {
  billingCycleStart: "2026-07-01T00:00:00.000Z",
  billingCycleEnd: "2026-08-01T00:00:00.000Z",
  membershipType: "pro",
  individualUsage: {
    plan: { enabled: true, used: 730, limit: 2000, remaining: 1270, totalPercentUsed: 36.5 },
    onDemand: { enabled: true, used: 125, limit: 5000, remaining: 4875 },
  },
};

test("parses plan and on-demand windows from a usage summary", () => {
  const { plan, windows } = parseCursorUsageSummary(sampleSummary);
  assert.equal(plan, "Pro");
  assert.equal(windows.length, 2);

  const [included, onDemand] = windows;
  assert.equal(included.name, "Included usage · $7.30 of $20");
  assert.equal(included.usedPercent, 36.5);
  assert.equal(included.durationMinutes, 44_640);
  assert.equal(included.resetsAt, "2026-08-01T00:00:00.000Z");

  assert.equal(onDemand.name, "On-demand · $1.25 of $50");
  assert.equal(onDemand.usedPercent, 2.5);
});

test("falls back through lane percents and dollar ratios for the headline percent", () => {
  const lanes = parseCursorUsageSummary({
    individualUsage: { plan: { autoPercentUsed: 40, apiPercentUsed: 20 } },
  });
  assert.equal(lanes.windows[0].usedPercent, 30);

  const ratio = parseCursorUsageSummary({
    individualUsage: { plan: { used: 500, limit: 2000 } },
  });
  assert.equal(ratio.windows[0].usedPercent, 25);

  const enterprise = parseCursorUsageSummary({
    individualUsage: { overall: { used: 7384, limit: 10000 } },
  });
  assert.ok(Math.abs(enterprise.windows[0].usedPercent - 73.84) < 1e-9);
  assert.equal(enterprise.windows[0].name, "Included usage");
});

test("handles empty, malformed, or windowless summaries", () => {
  assert.deepEqual(parseCursorUsageSummary(null), { plan: null, windows: [] });
  assert.deepEqual(parseCursorUsageSummary({}), { plan: null, windows: [] });
  const disabledOnDemand = parseCursorUsageSummary({
    membershipType: "free_trial",
    individualUsage: { onDemand: { enabled: false, used: 0, limit: 0 } },
  });
  assert.deepEqual(disabledOnDemand, { plan: "Free trial", windows: [] });
});
