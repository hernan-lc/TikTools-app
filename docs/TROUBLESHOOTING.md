# Troubleshooting

## The app does not start

Check the basic setup first:

~~~bash
git submodule update --init --recursive
bun install
bun run typecheck
~~~

Confirm that `vendor/tiktok-signer/` contains the upstream package files. If the error mentions a native module or missing shared library, install the platform dependency required by `webview-napi` or `tray-icon-node`. Linux package guidance is in [Getting Started](GETTING_STARTED.md).

For development, run from a terminal so the host log remains visible:

~~~bash
bun run start
~~~

The compiled Windows executable intentionally has no console. Check `%LOCALAPPDATA%/TikTools/logs/TikTools.log` for startup failures, WebView or native-module errors, plugin worker failures, and provider errors. Cookie headers, credentials, and worker handshake tokens are redacted from this file.

## The window opens but the page is blank

Enable WebView DevTools for a local session:

~~~powershell
$env:TIKTOK_LIVE_DEVTOOLS = "1"
bun run start
~~~

Then inspect the browser console for frontend import, CSS, or runtime errors. Also check that the local Bun server started before the native WebView was created.

If the page loads but the host bridge does not respond, confirm that the app is running inside the native WebView. The frontend expects `window.ipc.postMessage`; a normal browser tab will not have the same host bridge.

## The tray icon is missing

The app catches tray initialization failures and continues with the WebView. In development, check the terminal; in a compiled Windows build, check `TikTools.log`. Install the native tray prerequisites for the operating system, then restart.

Closing the window should hide it. If the process must be stopped during development, use the terminal interrupt or the tray **Quit** action.

## Connection fails in guest mode

Guest bootstrap depends on the upstream discovery and session services. It can fail because of rate limits, temporary upstream changes, no matching live room, or a rejected anonymous WebSocket handshake.

Try the following:

1. Confirm the creator is live.
2. Remove the leading `@` and try again.
3. Retry after a short delay.
4. Use an authenticated Cookie header for a room that requires it.
5. Check the terminal error and the in-app connection error separately; they may describe different phases.

Do not repeatedly retry a rate-limited guest request.

## Connection fails with a Cookie header

Make sure the value is the complete Cookie request header, for example:

~~~text
sessionid=...; other_cookie=...
~~~

Do not include browser export formatting or quote the entire value unless the browser provides it that way. Never share the value in logs or bug reports. If authentication stops working, obtain a fresh authorized session rather than committing a workaround.

## Points or automations appear to reset

The app stores durable data under `%LOCALAPPDATA%/TikTools/` on Windows, independent of the current working directory. A custom `TIKTOOLS_HOME` or `TIKTOOLS_DATA_DIR` can intentionally change this location.

Check:

~~~powershell
Get-Location
Get-ChildItem "$env:LOCALAPPDATA\TikTools\data"
~~~

POSIX:

~~~bash
pwd
ls -la "${XDG_DATA_HOME:-$HOME/.local/share}/TikTools/data"
~~~

Stop the app before moving or replacing a database. Back up the app `data/` directory first. The points and automation databases are separate, so a problem in one does not necessarily affect the other.

## A plugin is unavailable

Check all of the following:

- The plugin is under `plugins/<directory>/plugin.json`.
- The manifest uses supported `manifestVersion` and `apiVersion` values.
- The plugin id, version, execution mode, and permissions are valid.
- The plugin declares every capability and network/files permission it needs.
- The plugin is installed and enabled in the Plugins tab.
- The optional native dependency used by the plugin is available on the current platform.

Read the terminal messages prefixed with `[automation-plugins]` during development, or `TikTools.log` in the compiled app. A sandbox plugin cannot use arbitrary Node modules, filesystem access, network access, or native modules outside its declared capability path. The worker is self-hosted by `TikTools.exe`; Node.js and `plugin-worker.cjs` are not required.

## Text-to-speech is unavailable

SonicBoom is an optional external integration, not part of `TikTools.exe`. If it is not installed or ready, the TTS action reports an unavailable-provider error and the rest of the app continues to work. Its process is launched with a hidden Windows window. Check `TikTools.log` for the provider error and confirm the configured SonicBoom command and health endpoint.

## UI changes are not visible

Restart the app after changing frontend files if the WebView did not reload. If CSS appears stale, confirm that the imported stylesheet is under `src/web/styles.css` and that the relevant file is included in its import list.

For responsive issues, inspect the nearest scroll container and check for missing `min-width: 0`, `min-height: 0`, or unintended nested overflow. See [Development Guide](DEVELOPMENT.md).

## Tests fail in vendored code

Use the project script:

~~~bash
bun run test
~~~

A bare `bun test` can discover the vendored signer tests. Those tests may expect generated `vendor/tiktok-signer/.../dist` files that are intentionally not checked in.

## Reporting a bug

Include:

- Operating system and Bun version.
- The command used to start the app.
- Whether guest or authenticated mode was used, without including credentials.
- The terminal error and the in-app error text.
- The active tab and the smallest reproducible steps.
- Whether the issue survives a clean checkout and a fresh `data/` backup.

Redact Cookie headers, usernames if sensitive, room identifiers, and personal viewer data.
