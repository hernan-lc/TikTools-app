# App plugins

TikTools has two plugin boundaries:

- `src/automation/plugins/` is the existing worker-backed automation extension
  contract for workflow nodes and behavior actions.
- `src/plugins/` is the host-level AppPlugin contract for providers such as
  audio and TTS.

The provider contract is generic. The application consumes an audio or TTS
provider from a registry and never imports `miniaudio_node`, SonicBoom, or
another provider-specific library.

## Runtime

`PluginRuntime` discovers `plugin.json`, validates the host/UI API ranges,
checks the platform target, and loads the declared entry with Bun's dynamic
`import()`. The default isolation level is `trusted`. `worker` and `process`
are accepted manifest modes for future RPC-backed loaders; this runtime reports
them as unavailable rather than silently treating them as secure.

Each plugin receives a scoped `PluginContext`. Provider registration, commands,
events, UI panels, and storage are owned by the host and cleaned up when the
plugin is unloaded. `audio` and `tts` are only added when the manifest grants
the corresponding permission. There is no general filesystem API in the
context.

## Package layout

The checked-in provider packages are development/package fixtures and can be
rebuilt into platform-specific releases:

```text
plugins/
├── miniaudio/
│   ├── plugin.json
│   ├── package.json
│   ├── dist/plugin.js
│   ├── native/miniaudio_node/
│   ├── locales/
│   └── assets/
└── sonicboom/
    ├── plugin.json
    ├── package.json
    ├── dist/plugin.js
    ├── locales/
    └── assets/
```

The MiniAudio N-API wrapper is private to `plugins/miniaudio`. Rust remains
behind N-API; no additional C ABI is introduced. SonicBoom owns its child
process and HTTP details inside `plugins/sonicboom`.

## Installation

`PluginPackager` creates a ZIP-compatible `.plugin` archive with a
`checksums.json` file. `PluginInstaller` extracts it to a staging directory,
validates the manifest, host version, target, checksums, symlink/path safety,
and an optional signature verifier, then swaps it into the user plugin
directory. Native code is never compiled during installation.

For a manual local install, use:

```bash
bun run install:plugin ./miniaudio-win32-x64.plugin
```

Pass `--replace` when upgrading an existing package.

User plugins live under the platform app-data directory:

```text
%LOCALAPPDATA%/TikTools/plugins/<plugin-id>/
%LOCALAPPDATA%/TikTools/plugin-data/<plugin-id>/settings.json
```

Reviewed development packages can be discovered from `plugins/` beside the
repository or application. Set `TIKTOOLS_BUILTIN_PLUGINS_DIR` to point at a
different reviewed package directory.

## Building provider packages

Build the JavaScript entry and native N-API binaries in CI or in the plugin's
own development environment. The root host package intentionally does not
declare `miniaudio_node`:

```bash
cd plugins/miniaudio
bun install
bun run build
```

The release job should place the matching precompiled
`miniaudio_node.<platform>-<arch>-<abi>.node` beside the wrapper and package
that directory as a platform-specific `.plugin` archive.

Treat trusted dynamic-import plugins as reviewed code. A Worker can isolate
JavaScript execution and a separate process is appropriate for untrusted native
code, but neither boundary is implied by `node:vm`.
