import { expect, test } from 'bun:test';

import { formatJsonText, tokenizeJson } from './CodeEditor.tsx';

test('formatJsonText pretty-prints valid JSON', () => {
  expect(formatJsonText('{"b":2,"a":1}')).toBe('{\n  "b": 2,\n  "a": 1\n}');
});

test('formatJsonText keeps templated strings intact', () => {
  expect(formatJsonText('{"usuario": "{{ event.user.uniqueId }}"}')).toContain('"{{ event.user.uniqueId }}"');
});

test('formatJsonText returns null for broken input', () => {
  expect(formatJsonText('{"a": }')).toBeNull();
  expect(formatJsonText('')).toBeNull();
  expect(formatJsonText('plain text')).toBeNull();
});

test('tokenizeJson marks keys vs strings', () => {
  const kinds = tokenizeJson('"usuario": "luna"').map((token) => token.cls);
  expect(kinds).toEqual(['codeed-key', 'codeed-punct', 'codeed-ws', 'codeed-str']);
});

test('tokenizeJson marks numbers, literals and punctuation', () => {
  const kinds = tokenizeJson('{"n": 1716382910, "ok": true, "x": null}').map((token) => token.cls);
  expect(kinds).toContain('codeed-num');
  expect(kinds).toContain('codeed-lit');
  expect(kinds).toContain('codeed-key');
});

test('tokenizeJson never throws on broken input', () => {
  for (const chunk of ['{', '"unterminated', '{{ event.user', '12.3.4', '   ', '}']) {
    const tokens = tokenizeJson(chunk);
    expect(tokens.map((token) => token.text).join('')).toBe(chunk);
  }
});
