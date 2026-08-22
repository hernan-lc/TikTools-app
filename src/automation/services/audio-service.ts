import type { AudioCapability } from '../capabilities.ts';
import type { JsonObject } from '../types.ts';

type NativeAudioPlayer = {
  loadFile(filePath: string): void;
  play(): void;
  stop(): void;
  setVolume(volume: number): void;
  isPlaying(): boolean;
};

type NativeAudioModule = {
  AudioPlayer: new () => NativeAudioPlayer;
  initializeAudio?: () => string;
};

export class NativeAudioService implements AudioCapability {
  readonly #players: NativeAudioPlayer[] = [];
  #modulePromise: Promise<NativeAudioModule> | undefined;

  async playFile(
    path: string,
    options: { volume?: number; overlap?: 'allow' | 'restart' | 'drop' } = {},
  ): Promise<JsonObject> {
    const filePath = path.trim();
    if (!filePath) throw new Error('Audio file path cannot be empty.');
    this.#prunePlayers();

    const overlap = options.overlap ?? 'allow';
    if (overlap === 'drop' && this.#players.some((player) => player.isPlaying())) {
      return { played: false, reason: 'already-playing' };
    }
    if (overlap === 'restart') {
      for (const player of this.#players) player.stop();
      this.#players.length = 0;
    }

    const module = await this.#loadModule();
    const player = new module.AudioPlayer();
    player.loadFile(filePath);
    player.setVolume(clamp(options.volume ?? 1, 0, 1));
    player.play();
    this.#players.push(player);
    return { played: true, path: filePath, activePlayers: this.#players.length };
  }

  stopAll(): void {
    for (const player of this.#players) player.stop();
    this.#players.length = 0;
  }

  async #loadModule(): Promise<NativeAudioModule> {
    this.#modulePromise ??= import('miniaudio_node').then((module) => {
      module.initializeAudio?.();
      return module;
    }).catch(() => {
      throw new Error('miniaudio_node is not installed or unavailable on this platform. Install the trusted native audio provider before using Play Sound.');
    });
    return this.#modulePromise;
  }

  #prunePlayers(): void {
    for (let index = this.#players.length - 1; index >= 0; index -= 1) {
      if (!this.#players[index]?.isPlaying()) this.#players.splice(index, 1);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
