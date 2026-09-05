# Process audio plugin example

This is a crash-isolated TikTools process plugin. It never opens or copies an
audio file. It receives the configured path, returns a typed SDK audio intent
(encoded as JSON `playAudio`-compatible data), and lets the TikTools host
validate the path and use its native audio backend.
The executable is still trusted code with the operating-system permissions of
the user; a process boundary is not an OS sandbox. The implementation uses
`tiktools-plugin-sdk` for framing and protocol plumbing and remains
`#![forbid(unsafe_code)]`.

Build it outside the application workspace:

```bash
cargo build --release --manifest-path examples/audio-process-plugin/Cargo.toml
```

Install a package containing these two files:

```text
audio.play.process/
  plugin.json
  tiktools-audio-process-plugin
```

The executable must be beside `plugin.json` and have the entry name declared by
the manifest. After copying the directory into the user plugin directory,
reload the Plugins view or restart TikTools. No host recompilation or plugin
registration is required.

The host accepts only the `audio.play` capability and `audio.output` permission
for this intent. It canonicalizes and revalidates the existing file immediately
before playback, so this plugin does not receive file bytes or a native file
handle.
