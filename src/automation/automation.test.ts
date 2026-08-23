import { describe, expect, test } from 'bun:test';

import { AutomationEventBus } from './event-bus.ts';
import { normalizeTikTokEvent } from './events.ts';
import { createBuiltInNodeRegistry } from './nodes/builtins.ts';
import { PluginManager } from './plugins/plugin-manager.ts';
import { PluginCapabilityBroker } from './plugins/capability-broker.ts';
import { AutomationRuntime } from './runtime.ts';
import { HttpService } from './services/http-service.ts';
import { NapiVmService } from './services/napi-vm-service.ts';
import { NapiVmLanguageService } from './services/napi-vm-language-service.ts';
import type { AutomationEvent, WorkflowGraph } from './types.ts';

describe('automation event normalization', () => {
  test('preserves gift details that the UI projection does not need', () => {
    const event = normalizeTikTokEvent({
      type: 'gift',
      method: 'WebcastGiftMessage',
      user: {
        userId: '42',
        nickname: 'Viewer',
        uniqueId: '@viewer',
        secUid: 'secret',
      },
      toUser: {
        userId: '7',
        nickname: 'Creator',
        uniqueId: '@creator',
        secUid: 'secret',
      },
      giftId: '5655',
      giftName: 'Rose',
      diamondCount: 1,
      repeatCount: 12,
      comboCount: 12,
      groupId: 'combo-1',
      repeatEnd: true,
      streakable: true,
      giftIconUrl: 'https://example.test/rose.png',
    }, { uniqueId: '@creator', roomId: 'room-1', connectionId: 'connection-1' });

    expect(event?.type).toBe('tiktok.gift');
    expect(event?.user?.uniqueId).toBe('viewer');
    expect(event?.data).toEqual({
      giftId: '5655',
      giftName: 'Rose',
      diamondCount: 1,
      repeatCount: 12,
      comboCount: 12,
      groupId: 'combo-1',
      repeatEnd: true,
      streakable: true,
      giftIconUrl: 'https://example.test/rose.png',
      toUser: {
        userId: '7',
        uniqueId: 'creator',
        nickname: 'Creator',
        avatarUrl: undefined,
      },
    });
  });
});

describe('automation event bus', () => {
  test('delivers events to exact and wildcard subscribers', async () => {
    const bus = new AutomationEventBus();
    const received: string[] = [];
    bus.subscribe('tiktok.chat', (event) => {
      received.push(`exact:${event.type}`);
    });
    bus.subscribe('*', (event) => {
      received.push(`all:${event.type}`);
    });

    bus.publish({
      id: 'event-1',
      type: 'tiktok.chat',
      timestamp: 1,
      data: { comment: 'hello' },
    });
    await bus.waitForIdle();

    expect(received).toEqual(['exact:tiktok.chat', 'all:tiktok.chat']);
  });
});

describe('automation runtime', () => {
  test('executes flow and data edges and follows the true branch', async () => {
    const logs: string[] = [];
    const runtime = new AutomationRuntime(createBuiltInNodeRegistry(), {
      log: (entry) => {
        if (entry.level === 'info') logs.push(entry.message);
      },
    });

    const graph: WorkflowGraph = {
      schemaVersion: 1,
      id: 'gift-threshold',
      name: 'Gift threshold',
      enabled: true,
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.event',
          version: 1,
          position: { x: 0, y: 0 },
          config: { eventType: 'tiktok.gift' },
        },
        {
          id: 'compare',
          type: 'condition.compare',
          version: 1,
          position: { x: 200, y: 0 },
          config: { operator: 'greater-or-equal', right: 100, leftPath: 'event.data.diamondCount' },
        },
        {
          id: 'log',
          type: 'action.log',
          version: 1,
          position: { x: 400, y: 0 },
          config: { message: 'Gift from {{ event.user.uniqueId }}' },
        },
      ],
      edges: [
        { id: 'flow-1', kind: 'flow', source: 'trigger', sourcePort: 'flow', target: 'compare', targetPort: 'flow' },
        { id: 'flow-2', kind: 'flow', source: 'compare', sourcePort: 'true', target: 'log', targetPort: 'flow' },
      ],
    };
    runtime.registerWorkflow(graph);

    const event: AutomationEvent = {
      id: 'gift-1',
      type: 'tiktok.gift',
      timestamp: 1,
      user: { uniqueId: 'viewer' },
      data: { diamondCount: 100, giftName: 'Rose' },
    };
    const result = await runtime.runWorkflow(graph.id, event);

    expect(result.status).toBe('completed');
    expect(logs).toEqual(['Gift from viewer']);
  });

  test('cooldown blocks the second execution for the same user', async () => {
    const logs: string[] = [];
    const runtime = new AutomationRuntime(createBuiltInNodeRegistry(), {
      log: (entry) => {
        if (entry.level === 'info') logs.push(entry.message);
      },
    });
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      id: 'cooldown-test',
      name: 'Cooldown test',
      enabled: true,
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.event',
          version: 1,
          position: { x: 0, y: 0 },
          config: { eventType: 'tiktok.chat' },
        },
        {
          id: 'cooldown',
          type: 'control.cooldown',
          version: 1,
          position: { x: 200, y: 0 },
          config: { durationMs: 60_000 },
        },
        {
          id: 'log',
          type: 'action.log',
          version: 1,
          position: { x: 400, y: 0 },
          config: { message: 'accepted' },
        },
      ],
      edges: [
        { id: 'flow-1', kind: 'flow', source: 'trigger', sourcePort: 'flow', target: 'cooldown', targetPort: 'flow' },
        { id: 'flow-2', kind: 'flow', source: 'cooldown', sourcePort: 'ready', target: 'log', targetPort: 'flow' },
      ],
    };
    runtime.registerWorkflow(graph);

    const event: AutomationEvent = {
      id: 'chat-1',
      type: 'tiktok.chat',
      timestamp: 1,
      user: { uniqueId: 'viewer' },
      data: { comment: 'hello' },
    };
    await runtime.runWorkflow(graph.id, event);
    await runtime.runWorkflow(graph.id, { ...event, id: 'chat-2' });

    expect(logs).toEqual(['accepted']);
  });
});

describe('automation capabilities and plugins', () => {
  test('napi-vm language service suggests normalized event properties', () => {
    const service = new NapiVmLanguageService();
    const analysis = service.analyze('script-editor', 'return event.data.dia', 22, 'tiktok.gift');

    expect(analysis.completions.some((completion) => completion.label === 'diamondCount')).toBe(true);
    expect(analysis.diagnostics).toEqual([]);
  });

  test('napi-vm language service uses the last event for completion values and hover', () => {
    const service = new NapiVmLanguageService();
    const event: AutomationEvent = {
      id: 'gift-live-1',
      type: 'tiktok.gift',
      timestamp: 100,
      user: { uniqueId: 'viewer' },
      data: { giftName: 'Rose', diamondCount: 25 },
    };
    const completionSource = 'return event.data.dia';
    const completionAnalysis = service.analyze('script-editor-live', completionSource, completionSource.length, 'tiktok.gift', event);
    const completion = completionAnalysis.completions.find((item) => item.label === 'diamondCount');
    expect(completion?.value).toBe(25);
    expect(completion?.valueSource).toBe('live-event');

    const hoverSource = 'return event.data.diamondCount';
    const hoverAnalysis = service.analyze('script-editor-live', hoverSource, hoverSource.length, 'tiktok.gift', event);
    expect(hoverAnalysis.hover?.value).toBe(25);
    expect(hoverAnalysis.hover?.documentation).toContain('25');
    expect(hoverAnalysis.hover?.valueSource).toBe('live-event');

    const rootSource = 'return e';
    const rootAnalysis = service.analyze('script-editor-root', rootSource, rootSource.length, 'tiktok.gift', event);
    expect(rootAnalysis.completions.find((item) => item.label === 'event')?.valueSource).toBe('live-event');

    const dataSource = 'return event.data';
    const dataAnalysis = service.analyze('script-editor-data', dataSource, dataSource.length, 'tiktok.gift', event);
    expect(dataAnalysis.hover?.path).toBe('event.data');
    expect(JSON.stringify(dataAnalysis.hover?.value)).toContain('"giftName":"Rose"');

    const sampleAnalysis = service.analyze('script-editor-sample', hoverSource, hoverSource.length, 'tiktok.gift');
    expect(sampleAnalysis.hover?.value).toBeUndefined();
    expect(sampleAnalysis.hover?.documentation).not.toContain('Example value');
  });

  test('sandbox capability broker enforces manifest network permissions', async () => {
    const manifest = {
      manifestVersion: 1 as const,
      id: 'dev.example.broker',
      name: 'Broker test',
      version: '1.0.0',
      apiVersion: 1 as const,
      executionMode: 'sandbox' as const,
      permissions: { capabilities: ['http.request'], network: ['api.example.test'] },
    };
    const broker = new PluginCapabilityBroker({
      available: {
        http: {
          request: async (options) => ({
            status: 200,
            ok: true,
            url: options.url,
            headers: {},
            body: { answer: 42 },
          }),
        },
      },
      getManifest: () => manifest,
    });

    await expect(broker.invoke('dev.example.broker', 'http.request', {
      method: 'GET',
      url: 'https://api.example.test/data',
    })).resolves.toMatchObject({ status: 200, body: { answer: 42 } });
    await expect(broker.invoke('dev.example.broker', 'http.request', {
      method: 'GET',
      url: 'https://evil.example.test/data',
    })).rejects.toThrow('network permission');
  });

  test('HTTP redirects are explicit and revalidated', async () => {
    const service = new HttpService();
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/start')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/final' },
        });
      }
      return new Response(JSON.stringify({ answer: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      await expect(service.request({
        method: 'GET',
        url: 'http://127.0.0.1/start',
        allowPrivateNetwork: true,
      })).rejects.toThrow('redirect blocked');

      await expect(service.request({
        method: 'GET',
        url: 'http://127.0.0.1/start',
        allowPrivateNetwork: true,
        redirect: 'follow',
        responseType: 'json',
      })).resolves.toMatchObject({ status: 200, body: { answer: 42 } });
      expect(requestedUrls).toEqual([
        'http://127.0.0.1/start',
        'http://127.0.0.1/start',
        'http://127.0.0.1/final',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sandbox audio capability requires an allowed file path', async () => {
    const manifest = {
      manifestVersion: 1 as const,
      id: 'dev.example.audio',
      name: 'Audio test',
      version: '1.0.0',
      apiVersion: 1 as const,
      executionMode: 'sandbox' as const,
      permissions: { capabilities: ['audio.play'], files: ['README.md'] },
    };
    const broker = new PluginCapabilityBroker({
      available: {
        audio: {
          playFile: async (path) => ({ played: true, path }),
        },
      },
      getManifest: () => manifest,
    });

    await expect(broker.invoke('dev.example.audio', 'audio.play', { path: 'README.md' }))
      .resolves.toMatchObject({ played: true });
    await expect(broker.invoke('dev.example.audio', 'audio.play', { path: 'package.json' }))
      .rejects.toThrow('outside the plugin file permissions');
  });

  test('napi-vm evaluates JSON scripts with event and input globals', () => {
    const messages: string[] = [];
    const vm = new NapiVmService();
    const value = vm.evaluate(
      'log("script ran"); return event.data.diamonds + inputs.bonus;',
      { event: { data: { diamonds: 41 } }, inputs: { bonus: 1 } },
      { scopeId: 'script-test', log: (message) => messages.push(message) },
    );

    expect(value).toBe(42);
    expect(messages).toEqual(['script ran']);
  });

  test('Script nodes can transform event data inside the graph runtime', async () => {
    const logs: string[] = [];
    const runtime = new AutomationRuntime(createBuiltInNodeRegistry(), {
      capabilities: { vm: new NapiVmService() },
      log: (entry) => {
        if (entry.level === 'info') logs.push(entry.message);
      },
    });
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      id: 'script-node-test',
      name: 'Script node test',
      enabled: true,
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.event',
          version: 1,
          position: { x: 0, y: 0 },
          config: { eventType: 'tiktok.gift' },
        },
        {
          id: 'script',
          type: 'transform.script',
          version: 1,
          position: { x: 200, y: 0 },
          config: { source: 'return event.data.diamonds + 1;' },
        },
        {
          id: 'log',
          type: 'action.log',
          version: 1,
          position: { x: 400, y: 0 },
          config: {},
        },
      ],
      edges: [
        { id: 'flow-1', kind: 'flow', source: 'trigger', sourcePort: 'flow', target: 'script', targetPort: 'flow' },
        { id: 'flow-2', kind: 'flow', source: 'script', sourcePort: 'flow', target: 'log', targetPort: 'flow' },
        { id: 'data-1', kind: 'data', source: 'script', sourcePort: 'value', target: 'log', targetPort: 'value' },
      ],
    };
    runtime.registerWorkflow(graph);

    const result = await runtime.runWorkflow(graph.id, {
      id: 'script-event',
      type: 'tiktok.gift',
      timestamp: 1,
      data: { diamonds: 41 },
    });

    expect(result.status).toBe('completed');
    expect(logs).toEqual(['42']);
  });

  test('HTTP requests use a capability supplied by the host', async () => {
    const logs: string[] = [];
    const runtime = new AutomationRuntime(createBuiltInNodeRegistry(), {
      capabilities: {
        http: {
          request: async () => ({
            status: 200,
            ok: true,
            url: 'https://api.example.test/ok',
            headers: { 'content-type': 'application/json' },
            body: { answer: 42 },
          }),
        },
      },
      log: (entry) => {
        if (entry.level === 'info') logs.push(entry.message);
      },
    });
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      id: 'http-test',
      name: 'HTTP test',
      enabled: true,
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.event',
          version: 1,
          position: { x: 0, y: 0 },
          config: { eventType: 'tiktok.chat' },
        },
        {
          id: 'request',
          type: 'action.http',
          version: 1,
          position: { x: 200, y: 0 },
          config: { method: 'GET', url: 'https://api.example.test/ok' },
        },
        {
          id: 'log',
          type: 'action.log',
          version: 1,
          position: { x: 400, y: 0 },
          config: { message: 'request finished' },
        },
      ],
      edges: [
        { id: 'flow-1', kind: 'flow', source: 'trigger', sourcePort: 'flow', target: 'request', targetPort: 'flow' },
        { id: 'flow-2', kind: 'flow', source: 'request', sourcePort: 'success', target: 'log', targetPort: 'flow' },
      ],
    };
    runtime.registerWorkflow(graph);
    const result = await runtime.runWorkflow(graph.id, {
      id: 'chat-http',
      type: 'tiktok.chat',
      timestamp: 1,
      data: { comment: 'hello' },
    });

    expect(result.status).toBe('completed');
    expect(logs).toEqual(['request finished']);
  });

  test('HTTP service rejects private hosts by default', async () => {
    const service = new HttpService();
    await expect(service.request({ method: 'GET', url: 'http://127.0.0.1:1' })).rejects.toThrow('private host');
  });

  test('plugin manager validates capabilities and unloads node types', () => {
    const registry = createBuiltInNodeRegistry();
    const manager = new PluginManager(registry);
    manager.register({
      manifest: {
        manifestVersion: 1,
        id: 'dev.example.test',
        name: 'Example plugin',
        version: '1.0.0',
        apiVersion: 1,
        executionMode: 'trusted',
        permissions: { capabilities: ['http.request'] },
      },
      nodes: [{
        definition: {
          type: 'example.test',
          version: 1,
          pluginId: 'dev.example.test',
          title: 'Example',
          category: 'Test',
          kind: 'transform',
          inputs: [],
          outputs: [],
          configSchema: {},
          requiredCapabilities: ['http.request'],
        },
        execute: () => ({ outputs: {} }),
      }],
    });

    expect(manager.hasPermission('dev.example.test', 'http.request')).toBe(true);
    expect(registry.get('example.test')).toBeDefined();
    expect(manager.unregister('dev.example.test')).toBe(true);
    expect(registry.get('example.test')).toBeUndefined();
  });
});
