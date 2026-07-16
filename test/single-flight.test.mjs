import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { singleFlight } = require("../src/single-flight.js");

test("singleFlight shares one in-progress refresh", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const refresh = singleFlight(async () => {
    calls += 1;
    await gate;
    return "quota";
  });

  const first = refresh();
  const second = refresh();
  assert.strictEqual(first, second);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.equal(await first, "quota");
});
