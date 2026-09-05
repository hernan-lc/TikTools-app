import { describe, expect, test } from 'bun:test';
import {
  addTags,
  clampDualRange,
  clampNumber,
  fileListToArray,
  filterComboOptions,
  filterMultiOptions,
  formatFileSize,
  normalizeHexColor,
  normalizeOtpValue,
  removeFileAt,
  splitTagCandidates,
} from './controls.ts';
import { controlKind, TIKTOOLS_CONTROL_EVENT } from './control-events.ts';

describe('shared control helpers', () => {
  test('clampNumber respects min/max', () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-5, 0, 10)).toBe(0);
    expect(clampNumber(50, 0, 10)).toBe(10);
    expect(clampNumber(7)).toBe(7);
  });

  test('clampDualRange keeps order and bounds', () => {
    expect(clampDualRange([80, 20], 0, 100)).toEqual([20, 80]);
    expect(clampDualRange([-10, 200], 0, 100)).toEqual([0, 100]);
    expect(clampDualRange([30, 70], 0, 100)).toEqual([30, 70]);
  });

  test('normalizeHexColor validates and expands', () => {
    expect(normalizeHexColor('#fe2c55')).toBe('#fe2c55');
    expect(normalizeHexColor('#FE2C55')).toBe('#fe2c55');
    expect(normalizeHexColor('#abc')).toBe('#aabbcc');
    expect(normalizeHexColor('red')).toBeNull();
    expect(normalizeHexColor('#12345')).toBeNull();
  });

  test('tag helpers split, dedupe, cap and validate', () => {
    expect(splitTagCandidates('a, b ,,c')).toEqual(['a', 'b', 'c']);
    const added = addTags(['Gift'], ['gift', 'Like', 'like', 'Share'], { maxTags: 3 });
    expect(added.tags).toEqual(['Gift', 'Like', 'Share']);
    expect(added.added).toEqual(['Like', 'Share']);
    const validated = addTags([], ['ok', 'no!'], { validate: (t) => /^[a-z]+$/.test(t) });
    expect(validated.tags).toEqual(['ok']);
  });

  test('normalizeOtpValue enforces mode and length', () => {
    expect(normalizeOtpValue('12a34b567', 6, 'numeric')).toBe('123456');
    expect(normalizeOtpValue('ab-12-cd!!', 6, 'alphanumeric')).toBe('ab12cd');
    expect(normalizeOtpValue('123456789', 4, 'numeric')).toBe('1234');
  });

  test('file helpers manage selection state without reading contents', () => {
    const a = new File(['a'], 'a.mp3');
    const b = new File(['b'], 'b.mp3');
    expect(fileListToArray(null)).toEqual([]);
    expect(fileListToArray([a, b]).map((f) => f.name)).toEqual(['a.mp3', 'b.mp3']);
    expect(removeFileAt([a, b], 0).map((f) => f.name)).toEqual(['b.mp3']);
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  test('combo and multi filters rank matches and handle empty queries', () => {
    const options = [
      { value: 'lima', label: 'Lima' },
      { value: 'arequipa', label: 'Arequipa' },
      { value: 'trujillo', label: 'Trujillo' },
    ];
    expect(filterComboOptions(options, '').map((o) => o.value)).toEqual(['lima', 'arequipa', 'trujillo']);
    expect(filterComboOptions(options, 'are').map((o) => o.value)).toEqual(['arequipa']);
    expect(filterComboOptions(options, 'zzz')).toEqual([]);
    expect(filterMultiOptions(options, 'tru').map((o) => o.value)).toEqual(['trujillo']);
  });
});

describe('control-event bridge compatibility', () => {
  test('keeps the tiktools:control event name', () => {
    expect(TIKTOOLS_CONTROL_EVENT).toBe('tiktools:control');
  });

  test('detects new native input kinds without breaking old ones', () => {
    const make = (tag: string, type = '') =>
      ({ tagName: tag, type, value: '', checked: false, getAttribute: () => null }) as unknown as Parameters<typeof controlKind>[0];
    expect(controlKind(make('TEXTAREA'))).toBe('textarea');
    expect(controlKind(make('SELECT'))).toBe('select');
    expect(controlKind(make('INPUT', 'number'))).toBe('number');
    expect(controlKind(make('INPUT', 'range'))).toBe('range');
    expect(controlKind(make('INPUT', 'password'))).toBe('password');
    expect(controlKind(make('INPUT', 'date'))).toBe('date');
    expect(controlKind(make('INPUT', 'time'))).toBe('time');
    expect(controlKind(make('INPUT', 'color'))).toBe('color');
    expect(controlKind(make('INPUT', 'file'))).toBe('file');
    expect(controlKind(make('INPUT', 'text'))).toBe('text');
  });
});
