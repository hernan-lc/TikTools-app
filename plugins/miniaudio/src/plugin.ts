import type { AppPlugin, AudioProvider, PluginContext } from '../../../sdk/plugin-api/index.ts';
import { createAudioPlayer } from '../native/miniaudio_node/index.js';
import { normalizeVolume, resolveSoundFile } from './settings.ts';

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
        // Settings are read on every use, so the Plugins UI applies without a restart.
        const soundsDir = await ctx.storage.get('soundsDir');
        const defaultVolume = await ctx.storage.get('defaultVolume');
        const path = resolveSoundFile(typeof soundsDir === 'string' ? soundsDir : '', file);
        if (!path) throw new Error('Audio file path cannot be empty.');
        prune();
        const overlap = options.overlap ?? 'allow';
        if (overlap === 'drop' && players.some((player) => player.isPlaying())) {
          return { played: false, reason: 'already-playing' };
        }
        if (overlap === 'restart') stopAll();
        const player = await createAudioPlayer();
        player.loadFile(path);
        player.setVolume(normalizeVolume(options.volume, defaultVolume));
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
