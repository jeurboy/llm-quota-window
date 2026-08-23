// Codex: rate limits and account usage read from the Codex CLI's app-server
// over its line-delimited JSON protocol.
const { app } = require("electron");
const {
  REQUEST_TIMEOUT_MS,
  CODEX_USAGE_PAGE_URL,
  PING_PROMPT,
  PING_TIMEOUT_MS,
} = require("../config");
const { runCli, spawnCli, cliInstalled, notDetectedError, commandError } = require("../cli");
const { localDateKey } = require("../format");
const { selectCodexDailyUsageBucket } = require("../codex-usage");

function callCodex(method, params = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    let nextId = 1;
    const pending = new Map();
    const processHandle = spawnCli("codex", ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      processHandle.kill();
      callback(value);
    };
    const request = (requestMethod, requestParams) => new Promise((requestResolve, requestReject) => {
      const id = nextId++;
      pending.set(id, { resolve: requestResolve, reject: requestReject });
      processHandle.stdin.write(`${JSON.stringify({ id, method: requestMethod, params: requestParams })}\n`);
    });
    const timer = setTimeout(() => finish(reject, new Error("Codex did not respond within 15 seconds.")), REQUEST_TIMEOUT_MS);

    processHandle.on("error", (error) => finish(reject, new Error(commandError("Codex", error))));
    processHandle.stderr.on("data", () => {});
    processHandle.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === undefined) continue;
          const pendingRequest = pending.get(message.id);
          if (!pendingRequest) continue;
          pending.delete(message.id);
          if (message.error) pendingRequest.reject(new Error(message.error.message || "Codex returned an error."));
          else pendingRequest.resolve(message.result);
        } catch {
          // App-server notifications are line-delimited JSON. Ignore malformed diagnostics.
        }
      }
    });

    (async () => {
      try {
        await request("initialize", {
          clientInfo: { name: "Quota Window", title: "Quota Window", version: app.getVersion() },
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        const result = await request(method, params);
        finish(resolve, result);
      } catch (error) {
        finish(reject, error);
      }
    })();
  });
}

function toWindow(window, fallbackName) {
  if (!window) return null;
  return {
    name: fallbackName,
    usedPercent: Number(window.usedPercent ?? 0),
    durationMinutes: window.windowDurationMins ?? null,
    resetsAt: window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : null,
  };
}

async function load() {
  if (!cliInstalled("codex")) throw notDetectedError("Codex CLI is not installed on this device.");
  const [result, tokenUsage] = await Promise.all([
    callCodex("account/rateLimits/read"),
    callCodex("account/usage/read"),
  ]);
  const snapshot = result.rateLimits;
  if (!snapshot) throw new Error("Codex is signed out. Run `codex login` and refresh.");
  const dailyBuckets = tokenUsage.dailyUsageBuckets || [];
  const today = localDateKey();
  const { bucket: dailyBucket, isToday } = selectCodexDailyUsageBucket(dailyBuckets, today);

  return {
    provider: "codex",
    label: "Codex",
    connected: true,
    plan: snapshot.planType || null,
    windows: [
      toWindow(snapshot.primary, "Current window"),
      toWindow(snapshot.secondary, "Secondary window"),
    ].filter(Boolean),
    credits: result.rateLimitResetCredits?.availableCount ?? 0,
    tokenUsage: {
      source: "Account usage",
      lifetimeTokens: tokenUsage.summary?.lifetimeTokens ?? null,
      dayTokens: dailyBucket?.tokens ?? 0,
      day: dailyBucket?.startDate || today,
      dayLabel: isToday ? "today" : dailyBucket ? `latest · ${dailyBucket.startDate}` : "today",
      peakDailyTokens: tokenUsage.summary?.peakDailyTokens ?? null,
    },
    updatedAt: new Date().toISOString(),
  };
}

function ping() {
  return runCli("codex", [
    "exec",
    "--skip-git-repo-check",
    "-s",
    "read-only",
    "--color",
    "never",
    PING_PROMPT,
  ], { timeout: PING_TIMEOUT_MS });
}

module.exports = { provider: "codex", label: "Codex", usagePageUrl: CODEX_USAGE_PAGE_URL, load, ping };
