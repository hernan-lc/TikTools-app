export interface NativeAudioPlayer {
  loadFile(filePath: string): void;
  play(): void;
  stop(): void;
  setVolume(volume: number): void;
  isPlaying(): boolean;
}

export function loadNative(): Promise<{
  AudioPlayer: new () => NativeAudioPlayer;
  initializeAudio?: () => string;
}>;

export function createAudioPlayer(): Promise<NativeAudioPlayer>;
