# TikTok LIVE Inbox (WebView + tray example)

This is a small Bun desktop example built with:

- [webview-napi](https://www.npmjs.com/package/webview-napi) for the native window and local WebView UI;
- [tray-icon-node](https://www.npmjs.com/package/tray-icon-node) for the system-tray menu;
- [tiktok-signer](https://github.com/nglmercer/tiktok-signer), included as vendor/tiktok-signer, for its ttl-live Node client.

The app has a three-step wizard:

1. choose anonymous guest mode or provide an optional authenticated TikTok cookie header;
2. enter the creator handle, for example @creator;
3. receive chat, gift, like, join, follow, and share events in the WebView.

The channel step also has “Pick a live automatically”. It follows the upstream example: it bootstraps an anonymous guest identity when needed, searches TikTok live rooms, chooses one result, and connects directly with its room ID.

The window hides to the system tray when it is closed. Use the tray menu to show it again or quit.

## Minimal architecture

- Embedded webview-napi runtime: the native event loop is pumped by the Bun process.
- One window plus one tray icon: closing the window hides it; the tray restores or quits it.
- Inline HTML and vanilla JavaScript: no Bun.serve(), port 0, Preact, or Vue is needed for this wizard.

Use a frontend framework only if this UI grows into a larger application with reusable screens and complex state. Add a second window only for a genuinely separate task; the current guest/authenticated flow fits cleanly in one window.

## Run

Linux needs the WebKitGTK and tray dependencies used by the native packages. On Debian or Ubuntu:

~~~~bash
sudo apt-get install libwebkit2gtk-4.0-dev libappindicator3-dev libsoup2.4-dev
~~~~

Then run:

~~~~bash
git submodule update --init --recursive
bun install
bun run typecheck
bun run start
~~~~

## Session modes

The current upstream ttl-live client supports two modes:

- Leave the first wizard field blank to bootstrap a short-lived, memory-only anonymous TikTok guest identity.
- Paste a Cookie request header from a logged-in browser to use an authenticated session.

The cookie, whether guest or authenticated, stays in memory and is never written to the repository. Do not log, commit, or share authenticated cookies. Use the app only with rooms you are authorized to monitor, and follow TikTok’s terms.

If guest bootstrap is rate-limited, returns no usable cookies, or the anonymous WebSocket handshake is rejected, the wizard displays the upstream error so you can retry with an authenticated Cookie header.
