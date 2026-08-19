// ZCode (the Z.ai coding CLI) stores OAuth credentials in
// ~/.zcode/v2/credentials.json with each value encrypted as
// "enc:v1:<iv>.<authTag>.<ciphertext>" using AES-256-GCM. The key is the
// SHA-256 of ZCODE_CREDENTIAL_SECRET or, when unset, of a deterministic
// machine fallback, mirroring ZCode's own cipher so the stored Z.ai token can
// be read without launching ZCode.
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");
const { homedir, platform, userInfo } = require("node:os");

const ENCRYPTED_VALUE_PREFIX = "enc:v1:";
const CREDENTIAL_SECRET_ENV = "ZCODE_CREDENTIAL_SECRET";
const CIPHER_ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

function zcodeCredentialSecret(env = process.env) {
  const override = typeof env[CREDENTIAL_SECRET_ENV] === "string" ? env[CREDENTIAL_SECRET_ENV].trim() : "";
  if (override) return override;
  let username = "unknown";
  try {
    username = userInfo().username;
  } catch {
    // userInfo can throw on odd environments; the fallback only needs stability.
  }
  return `zcode-credential-fallback:${platform()}:${homedir()}:${username}`;
}

function zcodeCipherKey(secret) {
  return createHash("sha256").update(secret).digest();
}

function encryptZcodeCredentialValue(value, env = process.env) {
  const key = zcodeCipherKey(zcodeCredentialSecret(env));
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    ENCRYPTED_VALUE_PREFIX,
    iv.toString("base64url"),
    ".",
    cipher.getAuthTag().toString("base64url"),
    ".",
    encrypted.toString("base64url"),
  ].join("");
}

function decryptZcodeCredentialValue(value, env = process.env) {
  if (typeof value !== "string" || !value.startsWith(ENCRYPTED_VALUE_PREFIX)) return value || null;
  const parts = value.slice(ENCRYPTED_VALUE_PREFIX.length).split(".");
  const [iv, authTag, encrypted] = parts;
  if (!iv || !authTag || !encrypted || parts.length !== 3) {
    throw new Error("ZCode credential decrypt failed: invalid ciphertext format.");
  }
  const ivBuffer = Buffer.from(iv, "base64url");
  const authTagBuffer = Buffer.from(authTag, "base64url");
  if (ivBuffer.length !== IV_LENGTH_BYTES || authTagBuffer.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("ZCode credential decrypt failed: invalid IV or auth tag length.");
  }
  const key = zcodeCipherKey(zcodeCredentialSecret(env));
  const decipher = createDecipheriv(CIPHER_ALGORITHM, key, ivBuffer);
  decipher.setAuthTag(authTagBuffer);
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function extractZcodeZaiToken({ credentialsJson, env = process.env } = {}) {
  if (!credentialsJson) return null;
  let credentials;
  try {
    credentials = JSON.parse(credentialsJson);
  } catch {
    return null;
  }
  const token = credentials["oauth:zai:access_token"];
  if (typeof token !== "string" || !token) return null;
  try {
    return decryptZcodeCredentialValue(token, env);
  } catch {
    // A key mismatch means ZCode encrypted the file under a different secret;
    // treat it as no credential rather than failing the whole refresh.
    return null;
  }
}

module.exports = {
  decryptZcodeCredentialValue,
  encryptZcodeCredentialValue,
  extractZcodeZaiToken,
};
