# Quota Window

A compact 660×460, resizable landscape desktop dashboard for the subscription quota windows of **Claude Code** and **Codex**. It runs on macOS and Windows. It opens at the bottom-right of the screen with Claude and Codex side by side and can be resized from any window edge or corner.

## What it shows

- Claude: the 5-hour session, all-model weekly, and Fable weekly subscription windows, including live percentage used and reset time.
- Codex: the quota windows returned by the locally installed Codex CLI, plus available reset credits.
- Tokens: today's Codex account tokens plus lifetime and peak-day totals; Claude Code tokens processed today in local session history (input, output, and cache tokens).
- A live countdown to each reset, manual refresh, and automatic refresh every 3 minutes.
- Compact window controls for minimizing the widget into the menu bar/system tray and pinning it always on top; the pin preference is remembered.
- macOS menu bar and Windows system tray integration with compact quota status, show/hide, refresh, always-on-top, and quit controls. Closing the dashboard keeps the tray app running.
- Left-clicking the menu-bar/tray icon opens a minimal anchored quota popup; right-clicking opens the full command menu. The popup hides automatically when focus moves elsewhere.
- Auto (system), light, and dark themes selectable from the widget, popup, or system tray; Auto reacts when the OS appearance changes.
- An optional **Ping Fable** action starts or updates Claude's 5-hour usage window with a minimal request, then refreshes the dashboard. Because it calls Claude, it consumes a small amount of quota.
- Optional **Start on login** support for macOS and Windows. Login launches stay hidden in the menu bar/system tray until the dashboard is opened.
- GitHub release checks against `jeurboy/llm-quota-window` at startup and every six hours, with manual checks from the widget or tray and a direct link when a newer version is available.
- A native alert opens the tray popup when a quota crosses each lower 10% step, when a 5-hour/session allowance drops below 20% left, or when a weekly allowance drops below 10% left. Each reset window is alerted only once per threshold crossing.

The app reads the credentials already managed by the official CLIs. It never writes, uploads, or logs credentials.

## Requirements

- Node.js 22+ (Node 25 used for development)
- [Claude Code](https://code.claude.com/) installed and signed in with `claude auth login`
- [Codex CLI](https://developers.openai.com/codex/cli/) installed and signed in with `codex login`

## Run locally

```bash
npm install
npm start
```

## Run the built binary

The current macOS release is built for Apple Silicon (M1 or newer).

### macOS DMG

1. Open `releases/v0.1.0/Quota Window-0.1.0-arm64.dmg`.
2. Drag **Quota Window** into **Applications**.
3. Open **Quota Window** from Applications.

This local build is not notarized. If macOS blocks the first launch, right-click the app and select **Open**, or run:

```bash
xattr -cr "/Applications/Quota Window.app"
open "/Applications/Quota Window.app"
```

You can also run the unpacked app directly:

```bash
open "releases/v0.1.0/mac-arm64/Quota Window.app"
```

For the ZIP release, extract `Quota Window-0.1.0-arm64-mac.zip`, then open `Quota Window.app`.

### Windows

After building on Windows with `npm run dist:win`, open the installer or portable `.exe` generated in `releases/v0.1.0/`. If Windows SmartScreen appears for an unsigned local build, choose **More info** and then **Run anyway**.

## Build installers

Build on the target operating system:

```bash
npm run dist:mac  # macOS .dmg and .zip
npm run dist:win  # Windows installer and portable .exe
```

The build script reads `version` from `package.json` and places every artifact in a matching version directory. For example, version `0.1.0` is written to `releases/v0.1.0/`. Bumping the package version automatically creates a new release directory on the next build.
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

## Security model

Quota Window is intentionally local-first. The only network request it makes is an authenticated request directly to Anthropic's Claude usage endpoint, using the local Claude Code OAuth credential. The Codex request runs through the installed `codex` CLI. No account data is sent to a third party.
