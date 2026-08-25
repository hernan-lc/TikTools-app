import { describe, expect, test } from 'bun:test';

import { BUILTIN_ACTION_TYPES, BUILTIN_TRANSLATION_CATALOG } from './catalog.ts';

describe('behavior i18n metadata', () => {
  test('normalizes bundled descriptors to default and i18key values', () => {
    const fetch = BUILTIN_ACTION_TYPES.find((type) => type.id === 'core.fetch');
    expect(fetch?.title).toMatchObject({ default: 'Call a URL', i18key: 'automation.action.core.fetch.title' });
    expect(fetch?.fields?.[0]?.label).toMatchObject({ default: 'Method', i18key: 'automation.action.core.fetch.field.method.label' });
    expect(BUILTIN_TRANSLATION_CATALOG.es?.['automation.action.core.fetch.title']).toBe('Llamar a una URL');
  });
});
