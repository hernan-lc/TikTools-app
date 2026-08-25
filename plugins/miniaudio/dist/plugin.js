// @bun
// plugins/miniaudio/native/miniaudio_node/index.js
import { basename, join } from "path";
import { pathToFileURL } from "url";
var nativePromise;
function loadNative() {
  const directory = basename(import.meta.dir) === "miniaudio_node" ? import.meta.dir : join(import.meta.dir, "..", "native", "miniaudio_node");
  const nativePath = pathToFileURL(join(directory, `miniaudio_node.${nativeTarget()}.node`)).href;
  nativePromise ??= import(nativePath).catch(() => {
    throw new Error("The MiniAudio N-API binary is not installed for this platform.");
  });
  return nativePromise;
}
async function createAudioPlayer() {
  const native = await loadNative();
  return new native.AudioPlayer;
}
function nativeTarget() {
  const abi = process.platform === "win32" ? "msvc" : process.platform === "linux" ? "gnu" : "darwin";
  return `${process.platform}-${process.arch}-${abi}`;
}

// plugins/miniaudio/src/plugin.ts
var plugin = {
  async activate(ctx) {
    if (!ctx.audio)
      throw new Error("MiniAudio requires the audio.output permission.");
    const players = [];
    const prune = () => {
      for (let index = players.length - 1;index >= 0; index -= 1) {
        if (!players[index]?.isPlaying())
          players.splice(index, 1);
      }
    };
    const stopAll = () => {
      for (const player of players)
        player.stop();
      players.length = 0;
    };
    const provider = {
      id: "miniaudio",
      name: "MiniAudio",
      capabilities: ["playback", "devices"],
      priority: 10,
      async play(file, options = {}) {
        const path = file.trim();
        if (!path)
          throw new Error("Audio file path cannot be empty.");
        prune();
        const overlap = options.overlap ?? "allow";
        if (overlap === "drop" && players.some((player2) => player2.isPlaying())) {
          return { played: false, reason: "already-playing" };
        }
        if (overlap === "restart")
          stopAll();
        const player = await createAudioPlayer();
        player.loadFile(path);
        player.setVolume(clamp(options.volume ?? 1, 0, 1));
        player.play();
        players.push(player);
        return { played: true, path, activePlayers: players.length };
      },
      stopAll
    };
    ctx.audio.registerProvider(provider);
    ctx.logger.info("MiniAudio provider activated.");
  }
};
var plugin_default = plugin;
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
export {
  plugin_default as default
};
