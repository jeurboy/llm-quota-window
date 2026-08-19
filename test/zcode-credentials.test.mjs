import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  decryptZcodeCredentialValue,
  encryptZcodeCredentialValue,
  extractZcodeZaiToken,
} = require("../src/zcode-credentials.js");

const env = { ZCODE_CREDENTIAL_SECRET: "test-secret" };

test("round-trips values through ZCode's enc:v1 ciphertext format", () => {
  const encrypted = encryptZcodeCredentialValue("jwt-token", env);
  assert.match(encrypted, /^enc:v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(encrypted, encryptZcodeCredentialValue("jwt-token", env));
  assert.equal(decryptZcodeCredentialValue(encrypted, env), "jwt-token");
});

test("returns plaintext values unchanged", () => {
  assert.equal(decryptZcodeCredentialValue("plain-token", env), "plain-token");
  assert.equal(decryptZcodeCredentialValue("", env), null);
});

test("throws on malformed ciphertext", () => {
  assert.throws(() => decryptZcodeCredentialValue("enc:v1:not-enough-parts", env), /invalid ciphertext format/);
  assert.throws(() => decryptZcodeCredentialValue(`enc:v1:${"A".repeat(16)}.${"B".repeat(24)}.short-iv`, env), /invalid IV/);
});

test("extracts and decrypts the Z.ai token from credentials JSON", () => {
  const credentialsJson = JSON.stringify({
    "oauth:active_provider": encryptZcodeCredentialValue("zai", env),
    "oauth:zai:access_token": encryptZcodeCredentialValue("jwt-token", env),
  });
  assert.equal(extractZcodeZaiToken({ credentialsJson, env }), "jwt-token");
});

test("returns null for missing or malformed credential files", () => {
  assert.equal(extractZcodeZaiToken({ credentialsJson: "", env }), null);
  assert.equal(extractZcodeZaiToken({ credentialsJson: "not json", env }), null);
  assert.equal(extractZcodeZaiToken({ credentialsJson: JSON.stringify({}), env }), null);
  assert.equal(extractZcodeZaiToken({ credentialsJson: JSON.stringify({ "oauth:zai:access_token": "" }), env }), null);
  assert.equal(extractZcodeZaiToken({ env }), null);
});

test("returns null when the file was encrypted under a different secret", () => {
  const credentialsJson = JSON.stringify({ "oauth:zai:access_token": encryptZcodeCredentialValue("jwt-token", env) });
  assert.equal(extractZcodeZaiToken({ credentialsJson, env: { ZCODE_CREDENTIAL_SECRET: "other-secret" } }), null);
});
