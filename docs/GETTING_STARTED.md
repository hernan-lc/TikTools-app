# Getting Started

This guide takes a fresh checkout to a running TikTools desktop window.

## Requirements

- [Bun](https://bun.sh/).
- Git with submodule support.
- A platform supported by `webview-napi` and `tray-icon-node`.
- The native build/runtime libraries required by those packages on your operating system.

TikTools uses a native WebView window and a system-tray icon. It is not a browser-only application.

## Install

Clone the repository, enter it, initialize the TikTok client submodule, and install dependencies:

~~~bash
git clone https://github.com/nglmercer/TikTools-app.git
cd TikTools-app
git submodule update --init --recursive
bun install
~~~

If the repository was downloaded as an archive instead of cloned with Git, make sure `vendor/tiktok-signer/` is present before starting the app.

## Linux packages

On Debian or Ubuntu, the WebView and tray packages generally need:

~~~bash
sudo apt-get install libwebkit2gtk-4.0-dev libappindicator3-dev libsoup2.4-dev
~~~

Package names vary by distribution. If the native package reports a missing library, install the development package that provides that library and run the command again.

## Verify the checkout

~~~bash
bun run typecheck
bun run test
bun run test:plugin-worker
~~~

The test script is scoped to the application tests under `src`. This avoids discovering tests in the vendored signer package that depend on generated files.

## Launch

~~~bash
bun run start
~~~

The host starts a Bun server on port `0`, allowing the operating system to choose a free local port. It then loads that URL in the embedded WebView. There is no separate frontend server to start.

The default window is resizable and opens at 900 × 680 pixels. Closing the window hides it in the tray; choose **Show live chat** from the tray menu to restore it.

## Windows standalone executable

Build the release executable from Windows with:

~~~powershell
bun run build:exe
~~~

The result is `dist/TikTools.exe`. It contains the Bun runtime and bundled Preact frontend, uses the GUI subsystem so no console window is shown, and starts sandbox plugins by launching itself with `--plugin-worker`. Bun and Node.js are not required on the target machine. Windows WebView2 is required.

Test it from a different working directory before distributing it:

~~~powershell
Set-Location $env:TEMP
& 'C:\path\to\TikTools-app\dist\TikTools.exe'
~~~

The executable should open the desktop window without PowerShell, cmd, or Bun console flashes. The release directory does not need `plugin-worker.cjs` or a separate Node.js installation.

## First launch

1. Select English or Spanish and choose a theme.
2. Enter a creator handle, with or without `@`.
3. Leave the Cookie field empty for anonymous guest bootstrap, or paste an authenticated Cookie request header.
4. Connect to the creator or choose automatic live selection.
5. Open [User Guide](USER_GUIDE.md) for the dashboard workflow.

The creator handle, recent handles, language, and theme are saved in WebView local storage. Cookies are held in memory only.

## Optional host bundle

To produce a distributable host bundle:

~~~bash
bun run build:host
~~~

The output is written to `dist/` as a development bundle. The plugin worker is imported from the TypeScript entry point and is not copied as a `plugin-worker.cjs` sidecar. A development bundle still assumes Bun and the native dependencies are available; use `build:exe` for the Windows standalone executable.

Set a different output directory when needed:

~~~bash
TIKTOOLS_HOST_OUTDIR=/path/to/output bun run build:host
~~~

PowerShell:

~~~powershell
$env:TIKTOOLS_HOST_OUTDIR = "C:\path\to\output"
bun run build:host
~~~

## Development WebView tools

DevTools are disabled by default. Enable them for a local debugging session:

~~~powershell
$env:TIKTOK_LIVE_DEVTOOLS = "1"
bun run start
~~~

On POSIX shells:

~~~bash
TIKTOK_LIVE_DEVTOOLS=1 bun run start
~~~

Do not enable DevTools in a build shared with users if the window can expose sensitive session data.

## Runtime data

On Windows, the first run creates `%LOCALAPPDATA%/TikTools/` with these directories:

- `data/` for SQLite databases.
- `plugins/` for sandbox plugin packages.
- `logs/` for `TikTools.log`.
- `temp/` for generated automation audio.

The databases are:

- `data/tiktok-points.db`
- `data/tiktok-automation.db`

The location is independent of the current working directory. Set `TIKTOOLS_HOME` to relocate the complete tree, or set `TIKTOOLS_DATA_DIR`, `TIKTOOLS_PLUGINS_DIR`, `TIKTOOLS_LOG_DIR`, or `TIKTOOLS_TEMP_DIR` separately for development and tests.

Back up the directory before manually changing or removing runtime data. See [Troubleshooting](TROUBLESHOOTING.md) before repairing a database.
