import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

let nativePromise;

export function loadNative() {
  const directory = basename(import.meta.dir) === 'miniaudio_node'
    ? import.meta.dir
    : join(import.meta.dir, '..', 'native', 'miniaudio_node');
  const nativePath = pathToFileURL(join(directory, `miniaudio_node.${nativeTarget()}.node`)).href;
  nativePromise ??= import(nativePath).catch(() => {
    throw new Error('The MiniAudio N-API binary is not installed for this platform.');
  });
  return nativePromise;
}

export async function createAudioPlayer() {
  const native = await loadNative();
  return new native.AudioPlayer();
}

function nativeTarget() {
  const abi = process.platform === 'win32' ? 'msvc' : process.platform === 'linux' ? 'gnu' : 'darwin';
  return `${process.platform}-${process.arch}-${abi}`;
}
