// Cursor: usage summary from cursor.com, authenticated with the editor's
// VS Code-style state store token.
const { existsSync, readFileSync } = require("fs");
const {
  REQUEST_TIMEOUT_MS,
  CURSOR_USAGE_SUMMARY_URL,
  CURSOR_USAGE_PAGE_URL,
  cursorStateDbPath,
} = require("../config");
const { notDetectedError } = require("../cli");
const { extractCursorSession, parseCursorUsageSummary } = require("../cursor-usage");

const CURSOR_SIGN_IN_MESSAGE = "Cursor is not signed in on this device. Open Cursor, sign in, and refresh.";

function getCursorSession() {
  const path = cursorStateDbPath();
  if (!path || !existsSync(path)) return null;
  const buffers = [];
  try {
    buffers.push(readFileSync(path));
    // A running Cursor may hold the freshest token in the WAL, not the main file.
    if (existsSync(`${path}-wal`)) buffers.push(readFileSync(`${path}-wal`));
  } catch {
    // An unreadable store is reported as signed out below.
  }
  return extractCursorSession(buffers);
}

async function load() {
  const session = getCursorSession();
  if (!session) throw notDetectedError(CURSOR_SIGN_IN_MESSAGE);
  const response = await fetch(CURSOR_USAGE_SUMMARY_URL, {
    headers: {
      Accept: "application/json",
      Cookie: `WorkosCursorSessionToken=${session.userId}%3A%3A${session.accessToken}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Cursor sign-in expired. Sign in inside Cursor and refresh."
      : `Cursor usage request failed (${response.status}).`);
  }
  const { plan, windows } = parseCursorUsageSummary(await response.json());
  return {
    provider: "cursor",
    label: "Cursor",
    connected: true,
    plan,
    windows,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { provider: "cursor", label: "Cursor", usagePageUrl: CURSOR_USAGE_PAGE_URL, load };
