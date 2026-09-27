import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readSettingsFile, updateSettingsFile } = require("../src/settings-file.js");

test("disconnect preference preserves keys, and removing a key preserves preferences", () => {
  const directory = mkdtempSync(join(tmpdir(), "quota-settings-"));
  const file = join(directory, "settings.json");
  try {
    writeFileSync(file, JSON.stringify({
      apiKeys: { minimax: "test-key", deepseek: "another-test-key" },
      autoPingIntervalMinutes: 30,
      disabledProviders: [],
    }));
    updateSettingsFile(file, { disabledProviders: ["minimax"] });
    assert.deepEqual(readSettingsFile(file).apiKeys, {
      minimax: "test-key", deepseek: "another-test-key",
    });
    updateSettingsFile(file, { apiKeys: { deepseek: "another-test-key" } });
    assert.deepEqual(readSettingsFile(file), {
      apiKeys: { deepseek: "another-test-key" },
      autoPingIntervalMinutes: 30,
      disabledProviders: ["minimax"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
