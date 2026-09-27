// Provider registry: every quota source the app can monitor, in display order.
// Each module exports { provider, label, usagePageUrl, load, ping? }.
const claude = require("./claude");
const codex = require("./codex");
const kimi = require("./kimi");
const cursor = require("./cursor");
const { gemini, antigravity } = require("./google");
const copilot = require("./copilot");
const openrouter = require("./openrouter");
const openaiApi = require("./openai-api");
const anthropicApi = require("./anthropic-api");
const groq = require("./groq");
const { xaiApi, supergrok } = require("./xai");
const zai = require("./zai");
const deepseek = require("./deepseek");
const minimax = require("./minimax");
const mimo = require("./mimo");

const quotaProviders = [
  claude,
  codex,
  kimi,
  cursor,
  gemini,
  antigravity,
  copilot,
  openrouter,
  openaiApi,
  anthropicApi,
  groq,
  xaiApi,
  supergrok,
  zai,
  deepseek,
  minimax,
  mimo,
];

const providerUsagePages = Object.fromEntries(
  quotaProviders.map(({ provider, usagePageUrl }) => [provider, usagePageUrl]),
);

module.exports = { quotaProviders, providerUsagePages, kimi, mimo };
