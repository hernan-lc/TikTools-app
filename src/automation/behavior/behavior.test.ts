import { describe, expect, test } from 'bun:test';

import type { AutomationCapabilities, HttpRequestOptions, HttpResponse } from '../capabilities.ts';
import type { AutomationEvent, JsonValue } from '../types.ts';
import { BehaviorEngine, matchesFilter, renderTemplate, sampleEventFor } from './engine.ts';
import { deriveActionPermissions, normalizeAction, normalizeEvent } from './schema.ts';
import type { LiveAction, LiveEvent } from './types.ts';

function giftEvent(diamondCount: number, uniqueId = 'luna_dev', giftName = 'Rosa'): AutomationEvent {
  return {
    id: `evt-${diamondCount}-${uniqueId}`,
    type: 'tiktok.gift',
    timestamp: 1_700_000_000_000,
    user: { uniqueId, nickname: 'Luna' },
    data: { giftName, diamondCount },
  };
}

function fetchAction(overrides: Partial<LiveAction> = {}): LiveAction {
  return normalizeAction({
    schemaVersion: 1,
    id: 'act-fetch',
    name: 'Aviso',
    typeId: 'core.fetch',
    enabled: true,
    config: {
      method: 'POST',
      url: 'https://hooks.example.com/live',
      headers: { 'content-type': 'application/json' },
      body: '{"usuario":"{{ event.user.uniqueId }}"}',
      timeoutMs: '5000',
    },
    ...overrides,
  });
}

function event(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return normalizeEvent({
    schemaVersion: 1,
    id: 'evt-1',
    name: 'Regalo',
    enabled: true,
    trigger: 'tiktok.gift',
    filters: [],
    cooldownMs: 0,
    cooldownScope: 'user',
    actionIds: ['act-fetch'],
    runMode: 'all',
    ...overrides,
  });
}

function harness(options: { http?: (request: HttpRequestOptions) => HttpResponse; vm?: () => JsonValue } = {}) {
  const requests: HttpRequestOptions[] = [];
  const published: AutomationEvent[] = [];
  const pointCalls: Array<{ uniqueId: string; delta: number }> = [];

  const capabilities: AutomationCapabilities = {
    http: {
      request: async (request) => {
        requests.push(request);
        return options.http?.(request)
          ?? { status: 200, ok: true, url: request.url, headers: {}, body: { ok: true } };
      },
    },
    points: {
      adjust: (uniqueId, delta) => {
        pointCalls.push({ uniqueId, delta });
        return { uniqueId, delta };
      },
    },
    vm: { evaluate: () => options.vm?.() ?? null },
  };

  const engine = new BehaviorEngine({
    capabilities,
    publish: (entry) => published.push(entry),
  });

  return { engine, requests, published, pointCalls };
}

describe('actions', () => {
  test('renders event placeholders and pins the allowlist to the configured host', async () => {
    const { engine, requests } = harness();
    const run = await engine.testAction(fetchAction(), giftEvent(100));

    expect(run.status).toBe('ok');
    expect(requests[0]?.body).toBe('{"usuario":"luna_dev"}');
    expect(requests[0]?.allowedHosts).toEqual(['hooks.example.com']);
  });

  test('refuses a URL whose host is templated, so the allowlist stays knowable', async () => {
    const { engine, requests } = harness();
    const action = fetchAction({ config: { method: 'POST', url: 'https://{{ event.user.uniqueId }}.example.com', headers: {}, body: '' } });
    const run = await engine.testAction(action, giftEvent(100));

    expect(run.status).toBe('error');
    expect(requests).toHaveLength(0);
  });

  test('a failing response becomes an error run', async () => {
    const { engine } = harness({ http: (request) => ({ status: 429, ok: false, url: request.url, headers: {}, body: null }) });
    const run = await engine.testAction(fetchAction(), giftEvent(100));

    expect(run.status).toBe('error');
    expect(run.error).toContain('429');
  });

  test('the points action reaches the points capability', async () => {
    const { engine, pointCalls } = harness();
    const action = normalizeAction({
      schemaVersion: 1,
      id: 'act-points',
      name: 'Puntos',
      typeId: 'core.points',
      enabled: true,
      config: { uniqueId: '{{ event.user.uniqueId }}', delta: '10' },
    });

    const run = await engine.testAction(action, giftEvent(1));
    expect(run.status).toBe('ok');
    expect(pointCalls).toEqual([{ uniqueId: 'luna_dev', delta: 10 }]);
  });

  test('an action from a plugin that is not installed refuses to run', async () => {
    const { engine } = harness();
    const action = normalizeAction({
      schemaVersion: 1,
      id: 'act-audio',
      name: 'Aplausos',
      typeId: 'audio.play',
      enabled: true,
      config: { file: 'a.wav', volume: '1', overlap: 'allow' },
    });

    const run = await engine.testAction(action, giftEvent(1));
    expect(run.status).toBe('error');
    expect(run.error).toContain('audio-native');
  });

  test('code actions perform the intents the script returns', async () => {
    const { engine, requests, published } = harness({
      vm: () => ({
        emit: [{ type: 'overlay.rank', data: { total: 41_200 } }],
        fetch: { url: 'https://hooks.example.com/rank', method: 'POST', body: '{}' },
      }),
    });

    const action = normalizeAction({
      schemaVersion: 1,
      id: 'act-code',
      name: 'Ranking',
      typeId: 'core.code',
      enabled: true,
      config: { source: 'return { fetch: { url: "https://hooks.example.com/rank" } }' },
    });

    const run = await engine.testAction(action, giftEvent(500));
    expect(run.status).toBe('ok');
    expect(requests[0]?.url).toBe('https://hooks.example.com/rank');
    expect(published.some((entry) => (entry.data as Record<string, unknown>).emitType === 'overlay.rank')).toBe(true);
  });
});

describe('events', () => {
  test('every filter must pass', async () => {
    const { engine, requests } = harness();
    engine.setActions([fetchAction()]);
    engine.setEvents([event({
      filters: [
        { path: 'event.data.diamondCount', operator: 'gte', value: '100' },
        { path: 'event.data.giftName', operator: 'eq', value: 'Universo' },
      ],
    })]);

    engine.handleEvent(giftEvent(500, 'luna_dev', 'Rosa'));
    await Bun.sleep(5);
    expect(requests).toHaveLength(0);

    engine.handleEvent(giftEvent(500, 'luna_dev', 'Universo'));
    await Bun.sleep(5);
    expect(requests).toHaveLength(1);
  });

  test('the "or" lives inside a single filter with `in`', async () => {
    const { engine, requests } = harness();
    engine.setActions([fetchAction()]);
    engine.setEvents([event({
      filters: [{ path: 'event.data.giftName', operator: 'in', value: '', values: ['Universo', 'León'] }],
    })]);

    engine.handleEvent(giftEvent(1, 'luna_dev', 'León'));
    await Bun.sleep(5);
    expect(requests).toHaveLength(1);

    engine.handleEvent(giftEvent(1, 'luna_dev', 'Rosa'));
    await Bun.sleep(5);
    expect(requests).toHaveLength(1);
  });

  test('the cooldown is per viewer', async () => {
    const { engine, requests } = harness();
    engine.setActions([fetchAction()]);
    engine.setEvents([event({ cooldownMs: 60_000, cooldownScope: 'user' })]);

    engine.handleEvent(giftEvent(100, 'luna_dev'));
    engine.handleEvent(giftEvent(100, 'luna_dev'));
    engine.handleEvent(giftEvent(100, 'otro_dev'));
    await Bun.sleep(10);

    expect(requests).toHaveLength(2);
  });

  test('random mode runs exactly one of the actions', async () => {
    const { engine, requests } = harness();
    engine.setActions([fetchAction(), fetchAction({ id: 'act-fetch-2', name: 'Otro' })]);
    engine.setEvents([event({ actionIds: ['act-fetch', 'act-fetch-2'], runMode: 'random' })]);

    engine.handleEvent(giftEvent(100));
    await Bun.sleep(10);

    expect(requests).toHaveLength(1);
  });

  test('a disabled action is skipped even when the event references it', async () => {
    const { engine, requests } = harness();
    engine.setActions([fetchAction({ enabled: false })]);
    engine.setEvents([event()]);

    engine.handleEvent(giftEvent(100));
    await Bun.sleep(5);

    expect(requests).toHaveLength(0);
  });

  test('only the matching trigger runs', async () => {
    const { engine, requests } = harness();
    engine.setActions([fetchAction()]);
    engine.setEvents([event({ trigger: 'tiktok.follow' })]);

    engine.handleEvent(giftEvent(100));
    await Bun.sleep(5);

    expect(requests).toHaveLength(0);
  });
});

describe('schema and filters', () => {
  test('permissions are derived from the action, not typed by hand', () => {
    const permissions = deriveActionPermissions(fetchAction());
    expect(permissions.network).toEqual(['hooks.example.com']);
    expect(permissions.capabilities).toContain('http.request');
  });

  test('an unknown action type is rejected', () => {
    expect(() => normalizeAction({ id: 'x', name: 'x', typeId: 'nope', config: {} })).toThrow();
  });

  test('an unknown trigger is rejected', () => {
    expect(() => normalizeEvent({ ...event(), trigger: 'tiktok.unknown' })).toThrow();
  });

  test('operators compare numbers and text against the sample event', () => {
    const sample = sampleEventFor('tiktok.gift');
    expect(renderTemplate('{{ event.data.giftName }}', sample)).toBe('Rosa');
    expect(matchesFilter({ path: 'event.data.diamondCount', operator: 'gte', value: '1' }, sample)).toBe(true);
    expect(matchesFilter({ path: 'event.data.giftName', operator: 'contains', value: 'ros' }, sample)).toBe(true);
    expect(matchesFilter({ path: 'event.data.repeatEnd', operator: 'is-true', value: '' }, sample)).toBe(true);
  });
});
