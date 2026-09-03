import { expect, test } from 'bun:test';

import { normalizeVolume, resolveSoundFile } from './settings.ts';

test('absolute paths pass through, relative resolve against the library', () => {
  expect(resolveSoundFile('', 'alert.wav')).toBe('alert.wav');
  expect(resolveSoundFile(undefined, 'alert.wav')).toBe('alert.wav');
  expect(resolveSoundFile('/sounds', '/other/alert.wav')).toBe('/other/alert.wav');
  expect(resolveSoundFile('/sounds', 'alerts/horn.wav')).toBe('/sounds/alerts/horn.wav');
});

test('action volume wins, plugin default covers gaps, result clamps', () => {
  expect(normalizeVolume(0.5, 1)).toBe(0.5);
  expect(normalizeVolume(undefined, 0.4)).toBe(0.4);
  expect(normalizeVolume(undefined, undefined)).toBe(1);
  expect(normalizeVolume(2, 1)).toBe(1);
  expect(normalizeVolume(-1, 1)).toBe(0);
  expect(normalizeVolume('0.3', 1)).toBe(1);
});
