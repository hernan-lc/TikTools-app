# TikTok LIVE Inbox (WebView + tray example)

This is a small Bun desktop example built with:

- [webview-napi](https://www.npmjs.com/package/webview-napi) for the native window and local WebView UI;
- [tray-icon-node](https://www.npmjs.com/package/tray-icon-node) for the system-tray menu;
- [Preact](https://preactjs.com/) for the small, component-based wizard UI;
- a small in-app i18n layer with English and Spanish translations, plus dark and light themes;
- [tiktok-signer](https://github.com/nglmercer/tiktok-signer), included as vendor/tiktok-signer, for its ttl-live Node client.

The app has a three-step wizard:

1. choose the interface language and dark/light theme;
2. enter a creator handle and optionally provide an authenticated TikTok cookie header;
3. use the dashboard to receive chat, gift, like, join, follow, and share events in the WebView.

The configuration step also has “Pick a live automatically”. It follows the upstream example: it bootstraps an anonymous guest identity when needed, searches TikTok live rooms, chooses one result, and connects directly with its room ID.

The window hides to the system tray when it is closed. Use the tray menu to show it again or quit.

On the first run, the wizard asks for a creator username. That username is saved in WebView local storage and used to reconnect automatically on later launches, so setup is not shown every time. Use the Configuration button in the messages view to change the username or provide an optional authenticated Cookie header. Cookies remain memory-only.

## Minimal architecture

- `Bun.serve({ port: 0 })` serves `src/web/index.html` and its bundled Preact/CSS assets on an ephemeral localhost port.
- The embedded `webview-napi` window loads that URL, so the frontend stays modular and can use normal TypeScript modules and framework tooling.
- `src/live-controller.ts` owns discovery, guest bootstrap, WebSocket reconnects, and event conversion; `src/bridge.ts` validates WebView IPC messages.
- `src/automation/` contains the event bus, workflow runtime, built-in nodes, host capabilities, and plugin boundary. The reusable visual workflow UI lives in `src/web/components/node-editor/`; it edits the app-owned workflow model through cards, a creation wizard, and typed forms. See [docs/AUTOMATIONS.md](docs/AUTOMATIONS.md) for the graph model and integration examples.
- `src/web/i18n.ts` and `src/web/preferences.ts` keep language/theme state in the frontend; preferences persist in WebView local storage and default to the browser language/system theme.
- One native window plus one tray icon is enough: closing the window hides it, while the tray restores or quits it.

Preact is a good fit here because it provides reusable components and predictable state with very little runtime overhead. Vue would also work, but would add a larger dependency and a second framework style without a benefit for this small wizard. A second native window is not needed unless settings or another independent workflow grows later.

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

The server binds to port `0`, so the operating system selects a free local port. The selected URL is passed directly to the embedded WebView; no fixed port or separate frontend process is required.

## Session modes

The current upstream ttl-live client supports two modes:

- Leave the first wizard field blank to bootstrap a short-lived, memory-only anonymous TikTok guest identity.
- Paste a Cookie request header from a logged-in browser to use an authenticated session.

The cookie, whether guest or authenticated, stays in memory and is never written to the repository. Do not log, commit, or share authenticated cookies. Use the app only with rooms you are authorized to monitor, and follow TikTok’s terms.

If guest bootstrap is rate-limited, returns no usable cookies, or the anonymous WebSocket handshake is rejected, the wizard displays the upstream error so you can retry with an authenticated Cookie header.
