# Quota Window

A compact 660×460, resizable landscape desktop dashboard for the subscription quota windows of **Claude Code**, **Codex**, **Kimi Code**, and **Cursor**. It runs on macOS and Windows. It opens at the bottom-right of the screen with the providers side by side and can be resized from any window edge or corner.

## What it shows

- Claude: the 5-hour session, all-model weekly, and Fable weekly subscription windows, including live percentage used and reset time.
- Codex: the quota windows returned by the locally installed Codex CLI, plus available reset credits.
- Kimi Code: the 5-hour rate window and weekly quota of the signed-in Kimi membership, including live percentage used and reset time.
- Cursor: included-plan and on-demand usage for the current billing cycle of the Cursor account signed in to the Cursor editor, including percentage used and the cycle end date.
- Gemini: daily model quotas (Pro/Flash tiers) of the Google account signed in with the Gemini CLI or Antigravity, read from `~/.gemini/oauth_creds.json`.
- Antigravity: per-model quotas when the account has Antigravity-specific allowances; hidden when it shares the Gemini pool.
- Copilot: premium request and chat quota of the GitHub account signed in to Copilot in an editor, read from `~/.config/github-copilot`.
- Providers that are not installed or signed in on the device are hidden automatically.
- Tokens: today's Codex account tokens plus lifetime and peak-day totals; Claude Code tokens processed today in local session history (input, output, and cache tokens).
- A live countdown to each reset, manual refresh, and automatic refresh every 3 minutes.
- Compact window controls for minimizing the widget into the menu bar/system tray and pinning it always on top; the pin preference is remembered.
- macOS menu bar and Windows system tray integration with compact quota status, show/hide, refresh, always-on-top, and quit controls. Closing the dashboard keeps the tray app running.
- Left-clicking the menu-bar/tray icon opens a minimal anchored quota popup; right-clicking opens the full command menu. The popup hides automatically when focus moves elsewhere.
- Auto (system), light, and dark themes selectable from the widget, popup, or system tray; Auto reacts when the OS appearance changes.
- An optional **Ping All** action sends one minimal request to every connected provider (Claude, Codex, and Kimi) to start or update their usage windows, then refreshes the dashboard. Because it calls each provider, it consumes a small amount of quota per provider.
- Optional Auto Ping All Providers can run every 30 minutes, 1 hour, or 2 hours from the tray menu; the choice is saved locally and each ping consumes a small amount of quota on every connected provider.
- Optional **Start on login** support for macOS and Windows. Login launches stay hidden in the menu bar/system tray until the dashboard is opened.
- GitHub release checks against `jeurboy/llm-quota-window` at startup and every six hours, with manual checks from the widget or tray and a direct link when a newer version is available.
- A native alert opens the tray popup when a quota crosses each lower 10% step, when a 5-hour/session allowance drops below 20% left, or when a weekly allowance drops below 10% left. Each reset window is alerted only once per threshold crossing.

The app reads the credentials already managed by the official CLIs. It never uploads or logs credentials; when Kimi Code's short-lived OAuth token expires, the app refreshes it and writes the new token back to the Kimi Code CLI's own credentials file, the same as the CLI does.

## Requirements

- Node.js 22+ (Node 25 used for development)
- [Claude Code](https://code.claude.com/) installed and signed in with `claude auth login`
- [Codex CLI](https://developers.openai.com/codex/cli/) installed and signed in with `codex login`
- [Kimi Code CLI](https://www.kimi.com/code/) installed and signed in with `/login`
- [Cursor](https://cursor.com/) installed and signed in (optional; used only to read your own usage)

## Run locally

```bash
npm install
npm start
```

## Run the built binary

The current macOS release is built for Apple Silicon (M1 or newer).

### macOS DMG

1. Open `releases/v0.1.2/Quota Window-0.1.2-arm64.dmg`.
2. Drag **Quota Window** into **Applications**.
3. Open **Quota Window** from Applications.

This local build is not notarized. If macOS blocks the first launch, right-click the app and select **Open**, or run:

```bash
xattr -cr "/Applications/Quota Window.app"
open "/Applications/Quota Window.app"
```

You can also run the unpacked app directly:

```bash
open "releases/v0.1.2/mac-arm64/Quota Window.app"
```

For the ZIP release, extract `Quota Window-0.1.2-arm64-mac.zip`, then open `Quota Window.app`.

### Windows

After building on Windows with `npm run dist:win`, open the installer or portable `.exe` generated in `releases/v0.1.2/`. If Windows SmartScreen appears for an unsigned local build, choose **More info** and then **Run anyway**.

## Build installers

Build on the target operating system:

```bash
npm run dist:mac  # macOS .dmg and .zip
npm run dist:win  # Windows installer and portable .exe
```

The build script reads `version` from `package.json` and places every artifact in a matching version directory. For example, version `0.1.2` is written to `releases/v0.1.2/`. Bumping the package version automatically creates a new release directory on the next build.
The shared `releases/README.md` contains user-facing installation and first-use steps, ready to attach alongside the installer files on GitHub Releases.

Run the script directly when needed:

```bash
node scripts/build-release.mjs --mac
node scripts/build-release.mjs --win
node scripts/build-release.mjs --all
```

The release script regenerates native 1x/2x macOS menu-bar template icons from `assets/tray-icon.svg` before packaging. To regenerate them without building an installer, run `npm run icons:tray`.

## Platform notes

- macOS: Claude Code credentials are read from the user Keychain entry that Claude Code creates. macOS may ask for permission the first time.
- Windows: the app checks the standard Claude Code credentials files. If Claude is not detected, sign in again with `claude auth login`.
- Codex's app-server is used rather than scraping a web page, so its returned quota windows and reset times are authoritative for the signed-in Codex account.
- Kimi Code credentials are read from `~/.kimi-code/credentials/kimi-code.json` (or `$KIMI_CODE_HOME`). Gemini/Antigravity credentials are read from `~/.gemini/oauth_creds.json`.
- No OAuth client ids are embedded in the app. Expired Kimi and Google tokens are refreshed by their own CLIs when used; to let Quota Window refresh them itself, set `KIMI_CLIENT_ID` or `GEMINI_OAUTH_CLIENT_ID`/`GEMINI_OAUTH_CLIENT_SECRET` to the public client values of those CLIs.
- Cursor's session is read from the Cursor editor's local state store (`state.vscdb` under the Cursor user-data directory) and used only to call Cursor's own usage endpoint. Cursor has no public usage API, so this endpoint may change without notice; if it does, the Cursor card shows an error until the app is updated.

## Security model

Quota Window is intentionally local-first. Its only network requests are authenticated calls directly to Anthropic's Claude usage endpoint, Kimi's usage endpoint, and Cursor's usage endpoint, using the local CLI/editor OAuth credentials. The Codex request runs through the installed `codex` CLI. No account data is sent to a third party.
