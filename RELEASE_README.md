# Quota Window — Installation Guide

Thank you for downloading Quota Window. This app shows usage from supported accounts signed in on your computer, with optional API keys and MiMo console sign-in.

## Screenshots

### Dashboard

![Quota Window dashboard](assets/full.png)

### Menu bar popup

![Quota Window compact menu bar popup](assets/mini.png)

## macOS (Apple Silicon)

1. Download the latest `Quota Window-*-arm64.dmg` for a normal install, or `Quota Window-*-arm64-mac.zip` for a portable copy.
2. Open the DMG and drag **Quota Window** to **Applications**. For the ZIP, extract it and move `Quota Window.app` to **Applications**.
3. Launch **Quota Window**.
4. If macOS blocks the unsigned local build, Control-click the app, choose **Open**, then choose **Open** again.

The macOS build requires Apple Silicon (M1 or newer).

## Windows

1. Download the installer (`.exe`) for a normal installation, or the portable `.exe` if you do not want to install it.
2. Run the downloaded file and follow the prompts.
3. If Microsoft Defender SmartScreen appears for this unsigned build, select **More info** then **Run anyway** only if you downloaded it from the official project release.

## First use

- Install and sign in to [Claude Code](https://code.claude.com/) with `claude auth login`.
- Install and sign in to the [Codex CLI](https://developers.openai.com/codex/cli/) with `codex login`.
- Open Quota Window, then press **Refresh now**. The app checks enabled providers every 3 minutes after that.
- Use **Providers** to enter a DeepSeek or MiniMax API key, sign in to MiMo from its card, or disconnect a provider.
- Click the **Q** in the macOS menu bar or Windows system tray for the compact popup. Right-click it for settings and quit.
- The tray menu can run **Auto Ping All Providers** every 30 minutes, 1 hour, or 2 hours. Each ping uses a small amount of quota on connected providers.

Quota Window keeps API keys entered in the app and MiMo sign-in data locally on your device. It sends credentials only to their respective providers to read usage. **Disconnect** removes credentials stored by Quota Window and stops monitoring that provider.

## Help

Project page: [github.com/jeurboy/llm-quota-window](https://github.com/jeurboy/llm-quota-window)
