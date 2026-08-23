// Claude Code: usage windows from Anthropic's OAuth usage endpoint, local
// token history from ~/.claude/projects, sign-in state from the CLI.
const { existsSync, readFileSync, readdirSync, statSync } = require("fs");
const { join } = require("path");
const {
  REQUEST_TIMEOUT_MS,
  CLAUDE_API_VERSION,
  CLAUDE_USAGE_URL,
  CLAUDE_USAGE_PAGE_URL,
  CLAUDE_PING_MODEL,
  CLAUDE_PROJECTS_ROOT,
  PING_PROMPT,
  PING_TIMEOUT_MS,
  claudeCredentialPaths,
} = require("../config");
const { runCli, runJson, cliInstalled, notDetectedError } = require("../cli");
const { localDateKey } = require("../format");

// Backs off while Anthropic's usage endpoint reports 429.
let claudeRetryAt = 0;

function startOfLocalDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function claudeLocalTokenUsage() {
  const root = CLAUDE_PROJECTS_ROOT;
  if (!existsSync(root)) return null;
  const seenRequests = new Set();
  let tokens = 0;
  const start = startOfLocalDay();
  const paths = [root];

  while (paths.length) {
    const current = paths.pop();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) { paths.push(path); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try {
        if (statSync(path).mtimeMs < start) continue;
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (!line) continue;
          const item = JSON.parse(line);
          if (item.type !== "assistant" || !item.message?.usage || new Date(item.timestamp).getTime() < start) continue;
          const id = item.requestId || item.uuid;
          if (!id || seenRequests.has(id)) continue;
          seenRequests.add(id);
          const usage = item.message.usage;
          tokens += Number(usage.input_tokens || 0)
            + Number(usage.output_tokens || 0)
            + Number(usage.cache_read_input_tokens || 0)
            + Number(usage.cache_creation_input_tokens || 0);
        }
      } catch {
        // A session can be updated while this scan runs. Skip its unreadable line/file.
      }
    }
  }
  return { source: "Claude Code local history", dayTokens: tokens, day: localDateKey(), dayLabel: "today" };
}

function getClaudeCredentials() {
  if (process.platform === "darwin") {
    try {
      const raw = require("child_process").execFileSync(
        "security",
        ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        { encoding: "utf8", windowsHide: true },
      );
      return JSON.parse(raw).claudeAiOauth;
    } catch {
      // Fall through: older Claude Code versions store credentials in a file.
    }
  }

  for (const path of claudeCredentialPaths()) {
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        const credentials = parsed.claudeAiOauth || parsed.oauth || parsed;
        if (credentials.accessToken) return credentials;
      }
    } catch {
      // Try the next known credential location.
    }
  }
  return null;
}

function toClaudeWindow(item, fallbackName) {
  if (!item) return null;
  return {
    name: item.kind === "session" ? "5-hour session" : fallbackName,
    usedPercent: Number(item.percent ?? item.utilization ?? 0),
    durationMinutes: item.kind === "session" ? 300 : item.kind?.startsWith("weekly") ? 10_080 : null,
    resetsAt: item.resets_at || null,
  };
}

async function load() {
  if (!cliInstalled("claude")) throw notDetectedError("Claude Code CLI is not installed on this device.");
  if (Date.now() < claudeRetryAt) {
    const remainingSeconds = Math.ceil((claudeRetryAt - Date.now()) / 1_000);
    throw new Error(`Claude usage is temporarily rate limited. Retrying automatically in ${remainingSeconds}s.`);
  }
  const auth = await runJson("claude", ["auth", "status"]);
  if (!auth.loggedIn) throw new Error("Claude Code is signed out. Run `claude auth login` and refresh.");

  const credentials = getClaudeCredentials();
  if (!credentials?.accessToken) {
    throw new Error("Could not read Claude Code's local sign-in. Run `claude auth login` and refresh.");
  }
  const response = await fetch(CLAUDE_USAGE_URL, {
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "anthropic-version": CLAUDE_API_VERSION },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") || "", 10);
      const waitSeconds = Number.isFinite(retryAfterSeconds) ? Math.max(15, retryAfterSeconds) : 60;
      claudeRetryAt = Date.now() + (waitSeconds * 1_000);
      throw new Error(`Claude usage is temporarily rate limited. Retrying automatically in ${waitSeconds}s.`);
    }
    throw new Error(response.status === 401
      ? "Claude sign-in expired. Run `claude auth login` and refresh."
      : `Claude usage request failed (${response.status}).`);
  }
  claudeRetryAt = 0;
  const usage = await response.json();
  const limits = Array.isArray(usage.limits) ? usage.limits : [];
  const session = limits.find((item) => item.kind === "session") || usage.five_hour;
  const weekly = limits.find((item) => item.kind === "weekly_all") || usage.seven_day;
  const fable = limits.find((item) =>
    item.kind === "weekly_scoped"
    && item.scope?.model?.display_name?.toLowerCase() === "fable");

  return {
    provider: "claude",
    label: "Claude",
    connected: true,
    plan: auth.subscriptionType || credentials.subscriptionType || null,
    windows: [
      toClaudeWindow(session, "5-hour session"),
      toClaudeWindow(weekly, "Weekly allowance"),
      toClaudeWindow(fable, "Fable weekly allowance"),
    ].filter(Boolean),
    credits: usage.extra_usage?.is_enabled ? usage.extra_usage.remaining_dollars : null,
    tokenUsage: claudeLocalTokenUsage(),
    updatedAt: new Date().toISOString(),
  };
}

function ping() {
  return runCli("claude", [
    "--safe-mode",
    "--print",
    PING_PROMPT,
    "--system-prompt",
    "Reply only with the single word pong.",
    "--model",
    CLAUDE_PING_MODEL,
    "--tools",
    "",
    "--no-session-persistence",
    "--output-format",
    "json",
  ], { timeout: PING_TIMEOUT_MS });
}

module.exports = { provider: "claude", label: "Claude", usagePageUrl: CLAUDE_USAGE_PAGE_URL, load, ping };
