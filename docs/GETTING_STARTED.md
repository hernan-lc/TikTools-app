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

The output is written to `dist/` and includes the bundled host entry point plus `plugin-worker.cjs`. A packaged distribution still needs the runtime dependencies required by Bun, `webview-napi`, `tray-icon-node`, and any optional native provider it uses.

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

The first run creates the `data/` directory and these SQLite databases:

- `data/tiktok-points.db`
- `data/tiktok-automation.db`

Back up the directory before manually changing or removing runtime data. See [Troubleshooting](TROUBLESHOOTING.md) before repairing a database.
