import { expect, test } from 'bun:test';

import { filterSuggestions, type AutocompleteItem } from './autocomplete.ts';

const item = (value: string, label?: string): AutocompleteItem => ({ value, label: label ?? value });

test('empty query returns items in order', () => {
  const items = [item('event.user.uniqueId'), item('event.data.comment')];
  const out = filterSuggestions(items, '');
  expect(out.map((entry) => entry.item.value)).toEqual(['event.user.uniqueId', 'event.data.comment']);
});

test('field-name prefix outranks mid-path substring', () => {
  const items = [item('event.commentLog.extra'), item('event.user.comment')];
  const out = filterSuggestions(items, 'comment');
  expect(out[0]?.item.value).toBe('event.user.comment');
});

test('two-letter queries do not use the subsequence fallback', () => {
  const items = [item('event.user.uniqueId', 'UniqueId')];
  expect(filterSuggestions(items, 'eu')).toHaveLength(0);
  expect(filterSuggestions(items, 'euu')).toHaveLength(1);
});

test('last-segment match highlights the value range', () => {
  const items = [item('event.user.uniqueId')];
  const out = filterSuggestions(items, 'unique');
  expect(out).toHaveLength(1);
  expect(out[0]?.matchRanges).toEqual([{ start: 11, end: 17 }]);
});

test('url presets match by label or url', () => {
  const presets = [
    { ...item('http://localhost:3000/', 'localhost:3000'), kind: 'snippet' as const },
    { ...item('http://127.0.0.1:8000/', '127.0.0.1:8000'), kind: 'snippet' as const },
    { ...item('https://', 'https://'), kind: 'snippet' as const },
  ];
  expect(filterSuggestions(presets, '').map((entry) => entry.item.value)).toEqual([
    'http://localhost:3000/',
    'http://127.0.0.1:8000/',
    'https://',
  ]);
  expect(filterSuggestions(presets, 'local')[0]?.item.value).toBe('http://localhost:3000/');
  expect(filterSuggestions(presets, '127')[0]?.item.value).toBe('http://127.0.0.1:8000/');
  expect(filterSuggestions(presets, 'discord')).toHaveLength(0);
});
