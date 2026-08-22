declare module 'miniaudio_node' {
  export function initializeAudio(): string;

  export class AudioPlayer {
    loadFile(filePath: string): void;
    play(): void;
    stop(): void;
    setVolume(volume: number): void;
    isPlaying(): boolean;
    getState(): string;
  }
}
