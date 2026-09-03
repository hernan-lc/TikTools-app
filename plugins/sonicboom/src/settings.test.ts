import { expect, test } from 'bun:test';

import { buildBaseUrl, normalizeHost, normalizePort, parseVoices } from './settings.ts';

test('host falls back to loopback on garbage', () => {
  expect(normalizeHost(undefined)).toBe('127.0.0.1');
  expect(normalizeHost('')).toBe('127.0.0.1');
  expect(normalizeHost('has space')).toBe('127.0.0.1');
  expect(normalizeHost('192.168.1.10')).toBe('192.168.1.10');
});

test('port falls back to 3000 outside 1-65535', () => {
  expect(normalizePort(undefined)).toBe(3000);
  expect(normalizePort('4000')).toBe(4000);
  expect(normalizePort(0)).toBe(3000);
  expect(normalizePort(99999)).toBe(3000);
  expect(normalizePort(3000.5)).toBe(3000);
});

test('base url composes from stored values', () => {
  expect(buildBaseUrl('127.0.0.1', 3000)).toBe('http://127.0.0.1:3000');
  expect(buildBaseUrl(undefined, undefined)).toBe('http://127.0.0.1:3000');
});

test('voices parse the OpenAI list shape', () => {
  expect(parseVoices({ data: [{ id: 'M1', name: 'Male 1' }, { id: 'F1' }] }))
    .toEqual([{ id: 'M1', name: 'Male 1' }, { id: 'F1' }]);
});

test('voices accept plain arrays and reject garbage', () => {
  expect(parseVoices([{ id: 'M1' }])).toEqual([{ id: 'M1' }]);
  expect(parseVoices({ voices: [{ id: 'M1' }] })).toEqual([{ id: 'M1' }]);
  expect(parseVoices({})).toEqual([]);
  expect(parseVoices(null)).toEqual([]);
  expect(parseVoices({ data: [{ name: 'no id' }, 42] })).toEqual([]);
});
