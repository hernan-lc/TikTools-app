import { describe, expect, test } from 'bun:test';

import { i18nText, setPluginTranslations, t } from './i18n.ts';

describe('key/value i18n metadata', () => {
  test('resolves i18key and falls back to default', () => {
    setPluginTranslations({
      es: { 'test.greeting': 'Hola {name}' },
    });

    expect(i18nText('es', { default: 'Hello {name}', i18key: 'test.greeting' })).toBe('Hola {name}');
    expect(i18nText('en', { default: 'Hello', i18key: 'test.missing' })).toBe('Hello');
  });

  test('keeps the existing key-based t helper compatible with plugin keys', () => {
    setPluginTranslations({ en: { 'test.count': '{count} item' } });
    expect(t('en', 'test.count', { count: 2 })).toBe('2 item');
  });
});
