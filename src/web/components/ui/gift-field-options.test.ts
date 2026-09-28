import { expect, test } from 'bun:test';

import { giftCatalogEntriesFromOptions, isGiftPickerHint } from './gift-field-options.ts';

test('gift picker hints accept the marker and the kind shorthand', () => {
  expect(isGiftPickerHint({ picker: 'gift', optionsFrom: 'host.gifts' })).toBe(true);
  expect(isGiftPickerHint({ kind: 'gift', optionsFrom: 'host.gifts' })).toBe(true);
  expect(isGiftPickerHint({ kind: 'select', picker: 'gift' })).toBe(true);
  expect(isGiftPickerHint({ kind: 'select', optionsFrom: 'host.gifts' })).toBe(false);
  expect(isGiftPickerHint({ picker: 'user' })).toBe(false);
  expect(isGiftPickerHint({})).toBe(false);
  expect(isGiftPickerHint(undefined)).toBe(false);
});

test('dynamic gift options map back to picker entries', () => {
  expect(giftCatalogEntriesFromOptions(undefined)).toEqual([]);
  expect(giftCatalogEntriesFromOptions([])).toEqual([]);
  const entries = giftCatalogEntriesFromOptions([
    { value: 'Rose', label: 'Rose', meta: { giftId: '1', diamondCount: 1, iconUrl: 'https://example.com/rose.png' } },
    { value: 'Galaxy', label: 'Galaxy', meta: { giftId: '2', diamondCount: 1000 } },
    // Duplicates collapse first-wins; bad rows are skipped.
    { value: 'Rose', label: 'Rose', meta: { giftId: '9', diamondCount: 50 } },
    { value: '  ', label: '' },
    { value: '', label: '' },
  ]);
  expect(entries).toEqual([
    { id: '1', name: 'Rose', diamondCount: 1, iconUrl: 'https://example.com/rose.png' },
    { id: '2', name: 'Galaxy', diamondCount: 1000 },
  ]);
});

test('missing metadata degrades to a plain named row', () => {
  expect(giftCatalogEntriesFromOptions([{ value: ' GG ', label: 'GG' }])).toEqual([
    { id: 'GG', name: 'GG', diamondCount: 0 },
  ]);
  // Non-finite prices clamp to zero instead of leaking into the UI.
  expect(
    giftCatalogEntriesFromOptions([
      { value: 'Bad', label: 'Bad', meta: { diamondCount: Number.NaN } },
      { value: 'Neg', label: 'Neg', meta: { diamondCount: -5 } },
    ]),
  ).toEqual([
    { id: 'Bad', name: 'Bad', diamondCount: 0 },
    { id: 'Neg', name: 'Neg', diamondCount: 0 },
  ]);
});
