import { describe, expect, test } from 'bun:test';

import type { AutomationCapabilities, HttpRequestOptions, HttpResponse } from '../capabilities.ts';
import type { AutomationEvent, JsonValue } from '../types.ts';
import { LivePluginEngine, matchesCondition, renderTemplate, sampleEventFor } from './engine.ts';
import { deriveLivePluginPermissions, normalizeLivePlugin } from './schema.ts';
import type { LivePlugin } from './types.ts';

function giftEvent(diamondCount: number, uniqueId = 'luna_dev'): AutomationEvent {
  return {
    id: `evt-${diamondCount}-${uniqueId}`,
    type: 'tiktok.gift',
    timestamp: 1_700_000_000_000,
    user: { uniqueId, nickname: 'Luna' },
    data: { giftName: 'Rosa', diamondCount },
  };
}

function plugin(overrides: Partial<LivePlugin> = {}): LivePlugin {
  return normalizeLivePlugin({
    schemaVersion: 1,
    id: 'plg-test',
    name: 'Prueba',
    enabled: true,
    templateId: 'webhook',
    trigger: 'tiktok.gift',
    cooldownMs: 0,
    cooldownScope: 'user',
    action: {
      kind: 'fetch',
      method: 'POST',
      url: 'https://hooks.example.com/live',
      headers: { 'content-type': 'application/json' },
      body: '{"usuario":"{{ event.user.uniqueId }}"}',
    },
    ...overrides,
  });
}

function harness(options: {
  http?: (request: HttpRequestOptions) => Promise<HttpResponse> | HttpResponse;
  points?: (uniqueId: string, delta: number) => void;
  vm?: (source: string, event: JsonValue) => JsonValue;
} = {}) {
  const requests: HttpRequestOptions[] = [];
  const published: AutomationEvent[] = [];
  const pointCalls: Array<{ uniqueId: string; delta: number }> = [];

  const capabilities: AutomationCapabilities = {
    http: {
      request: async (request) => {
        requests.push(request);
        const response = await options.http?.(request);
        return response ?? { status: 200, ok: true, url: request.url, headers: {}, body: { ok: true } };
      },
    },
    points: {
      adjust: (uniqueId, delta) => {
        pointCalls.push({ uniqueId, delta });
        options.points?.(uniqueId, delta);
        return { uniqueId, delta };
      },
    },
    vm: {
      evaluate: (source, environment) => options.vm?.(source, environment.event) ?? null,
    },
  };

  const engine = new LivePluginEngine({
    capabilities,
    publish: (event) => published.push(event),
  });

  return { engine, requests, published, pointCalls };
}

describe('live plugin templates', () => {
  test('renders event placeholders into the request', async () => {
    const { engine, requests } = harness();
    const run = await engine.test(plugin(), giftEvent(100));

    expect(run.status).toBe('ok');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toBe('{"usuario":"luna_dev"}');
    expect(requests[0]?.allowedHosts).toEqual(['hooks.example.com']);
  });

  test('refuses a URL whose host is templated, so the allowlist stays knowable', async () => {
    const { engine, requests } = harness();
    const run = await engine.test(
      plugin({ action: { kind: 'fetch', method: 'POST', url: 'https://{{ event.user.uniqueId }}.example.com', headers: {}, body: '' } }),
      giftEvent(100),
    );

    expect(run.status).toBe('error');
    expect(requests).toHaveLength(0);
  });

  test('reports a failing response as an error run', async () => {
    const { engine } = harness({
      http: (request) => ({ status: 429, ok: false, url: request.url, headers: {}, body: null }),
    });
    const run = await engine.test(plugin(), giftEvent(100));

    expect(run.status).toBe('error');
    expect(run.error).toContain('429');
  });

  test('binds a well-known emit type to the points capability', async () => {
    const { engine, pointCalls, published } = harness();
    const run = await engine.test(
      plugin({
        templateId: 'points',
        action: { kind: 'emit', type: 'points.add', data: { uniqueId: '{{ event.user.uniqueId }}', delta: '10' } },
      }),
      giftEvent(1),
    );

    expect(run.status).toBe('ok');
    expect(pointCalls).toEqual([{ uniqueId: 'luna_dev', delta: 10 }]);
    expect(published[0]?.type).toBe('plugin.emit');
  });
});

describe('filter and cooldown', () => {
  test('a filtered-out event does not run the action', async () => {
    const { engine, requests } = harness();
    const gate = plugin({ condition: { path: 'event.data.diamondCount', operator: 'greater-or-equal', value: '100' } });
    engine.setAll([gate]);

    engine.handleEvent(giftEvent(10));
    await Promise.resolve();

    expect(requests).toHaveLength(0);
  });

  test('the cooldown is per viewer', async () => {
    const { engine, requests } = harness();
    engine.setAll([plugin({ cooldownMs: 60_000, cooldownScope: 'user' })]);

    engine.handleEvent(giftEvent(100, 'luna_dev'));
    engine.handleEvent(giftEvent(100, 'luna_dev'));
    engine.handleEvent(giftEvent(100, 'otro_dev'));
    await Bun.sleep(5);

    expect(requests).toHaveLength(2);
  });

  test('only the matching trigger runs', async () => {
    const { engine, requests } = harness();
    engine.setAll([plugin({ trigger: 'tiktok.follow' })]);

    engine.handleEvent(giftEvent(100));
    await Bun.sleep(5);

    expect(requests).toHaveLength(0);
  });
});

describe('code plugins', () => {
  test('performs the intents the script returns', async () => {
    const { engine, requests, published } = harness({
      vm: () => ({
        emit: [{ type: 'overlay.rank', data: { total: 41_200 } }],
        fetch: { url: 'https://hooks.example.com/rank', method: 'POST', body: '{}' },
      }),
    });

    const run = await engine.test(
      plugin({
        templateId: 'code',
        action: { kind: 'code', source: 'return { fetch: { url: "https://hooks.example.com/rank" } }' },
      }),
      giftEvent(500),
    );

    expect(run.status).toBe('ok');
    expect(published.some((event) => (event.data as Record<string, unknown>).emitType === 'overlay.rank')).toBe(true);
    expect(requests[0]?.url).toBe('https://hooks.example.com/rank');
  });

  test('refuses a host the script never declared', async () => {
    const { engine, requests } = harness({
      vm: () => ({ fetch: { url: 'https://otro-dominio.example/rank' } }),
    });

    const run = await engine.test(
      plugin({
        templateId: 'code',
        action: { kind: 'code', source: 'return { fetch: { url: "https://hooks.example.com/rank" } }' },
      }),
      giftEvent(500),
    );

    expect(run.status).toBe('error');
    expect(run.error).toContain('otro-dominio.example');
    expect(requests).toHaveLength(0);
  });
});

describe('schema', () => {
  test('derives permissions from the plugin instead of trusting input', () => {
    const permissions = deriveLivePluginPermissions(plugin());
    expect(permissions.network).toEqual(['hooks.example.com']);
    expect(permissions.capabilities).toContain('http.request');
    expect(permissions.localNetwork).toBe(false);
  });

  test('rejects an unknown trigger', () => {
    expect(() => normalizeLivePlugin({ ...plugin(), trigger: 'tiktok.unknown' })).toThrow();
  });

  test('renders and compares against the sample event', () => {
    const event = sampleEventFor('tiktok.gift');
    expect(renderTemplate('{{ event.data.giftName }}', event)).toBe('Rosa');
    expect(matchesCondition({ path: 'event.data.diamondCount', operator: 'greater-or-equal', value: '1' }, event)).toBe(true);
  });
});
