# Quota Window — Installation Guide

Thank you for downloading Quota Window. This app shows the local Claude Code and Codex quota windows from the accounts already signed in on your computer.

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
- Open Quota Window, then press **Refresh now**. The app checks both local accounts once a minute after that.
- Click the **Q** in the macOS menu bar or Windows system tray for the compact popup. Right-click it for settings and quit.

Quota Window only reads the credentials and usage data already managed by the official CLIs. It does not upload or store your account credentials.

## Help

Project page: [github.com/jeurboy/llm-quota-window](https://github.com/jeurboy/llm-quota-window)
