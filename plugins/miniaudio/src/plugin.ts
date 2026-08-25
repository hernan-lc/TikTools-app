import type { AppPlugin, AudioProvider, PluginContext } from '../../../sdk/plugin-api/index.ts';
import { createAudioPlayer } from '../native/miniaudio_node/index.js';

const plugin: AppPlugin = {
  async activate(ctx: PluginContext): Promise<void> {
    if (!ctx.audio) throw new Error('MiniAudio requires the audio.output permission.');
    const players: Array<Awaited<ReturnType<typeof createAudioPlayer>>> = [];
    const prune = (): void => {
      for (let index = players.length - 1; index >= 0; index -= 1) {
        if (!players[index]?.isPlaying()) players.splice(index, 1);
      }
    };
    const stopAll = (): void => {
      for (const player of players) player.stop();
      players.length = 0;
    };
    const provider: AudioProvider = {
      id: 'miniaudio',
      name: 'MiniAudio',
      capabilities: ['playback', 'devices'],
      priority: 10,
      async play(file, options = {}) {
        const path = file.trim();
        if (!path) throw new Error('Audio file path cannot be empty.');
        prune();
        const overlap = options.overlap ?? 'allow';
        if (overlap === 'drop' && players.some((player) => player.isPlaying())) {
          return { played: false, reason: 'already-playing' };
        }
        if (overlap === 'restart') stopAll();
        const player = await createAudioPlayer();
        player.loadFile(path);
        player.setVolume(clamp(options.volume ?? 1, 0, 1));
        player.play();
        players.push(player);
        return { played: true, path, activePlayers: players.length };
      },
      stopAll,
    };
    ctx.audio.registerProvider(provider);
    ctx.logger.info('MiniAudio provider activated.');
  },
};

export default plugin;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
