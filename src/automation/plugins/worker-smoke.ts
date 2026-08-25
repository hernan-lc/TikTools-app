import { PluginCapabilityBroker } from './capability-broker.ts';
import { AutomationPluginLoader } from './plugin-loader.ts';
import { PluginManager } from './plugin-manager.ts';
import { PluginWorkerHost } from './plugin-worker-host.ts';
import { createBuiltInNodeRegistry } from '../nodes/builtins.ts';
import type { NodeExecutionContext } from '../types.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const manifest = {
  manifestVersion: 1 as const,
  id: 'dev.tiktools.worker-smoke',
  name: 'TikTools worker smoke test',
  version: '1.0.0',
  apiVersion: 1 as const,
  executionMode: 'sandbox' as const,
  permissions: {
    capabilities: ['http.request'],
    network: ['api.example.test'],
  },
};

const syncHandler = 'return { outputs: { value: event.data.value + 1 }, next: ["flow"] };';
const asyncHandler = 'const response = await capability("http.request", { method: "GET", url: "https://api.example.test/data" }); return { outputs: { value: response.body.answer }, next: ["success"] };';
const actionHandler = 'const response = await capability("http.request", { method: "GET", url: "https://api.example.test/data" }); return { summary: `action ${response.body.answer}` };';

const source = `
import { registerNode } from "@tiktools/sdk";
registerNode({
  definition: {
    type: "worker.smoke.sync",
    version: 1,
    title: "Worker smoke sync",
    category: "Tests",
    kind: "transform",
    inputs: [],
    outputs: [],
    configSchema: {}
  },
  handler: ${JSON.stringify(syncHandler)}
});
registerNode({
  definition: {
    type: "worker.smoke.async",
    version: 1,
    title: "Worker smoke async",
    category: "Tests",
    kind: "action",
    inputs: [],
    outputs: [],
    configSchema: {},
    requiredCapabilities: ["http.request"]
  },
  isAsync: true,
  handler: ${JSON.stringify(asyncHandler)}
});
registerAction({
  definition: {
    id: "worker.smoke.action",
    version: 1,
    title: { en: "Worker smoke action", es: "Acción smoke del worker" },
    description: { en: "Action smoke", es: "Acción smoke" },
    tag: "test",
    source: { kind: "plugin", pluginId: "dev.tiktools.worker-smoke" },
    configSchema: { type: "object", properties: {} },
    requiredCapabilities: ["http.request"]
  },
  isAsync: true,
  handler: ${JSON.stringify(actionHandler)}
});
`;

async function main(): Promise<void> {
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
  const worker = new PluginWorkerHost({ manifest, source, broker });
  try {
    const loaded = await worker.start();
    const sync = await worker.execute(context('worker.smoke.sync'));
    const asyncResult = await worker.execute(context('worker.smoke.async'));
    const actionResult = await worker.executeAction(actionContext('worker.smoke.action'));
    if (loaded.nodes.length !== 2 || loaded.actions.length !== 1 || sync.outputs?.value !== 42 || asyncResult.outputs?.value !== 42 || actionResult.summary !== 'action 42') {
      throw new Error('Worker smoke test returned an unexpected result.');
    }
    await loaderSmoke();
    console.log('TikTools sandbox worker smoke test passed.');
  } finally {
    await worker.stop();
  }
}

async function loaderSmoke(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tiktools-plugin-loader-'));
  const directory = join(root, 'fixture');
  await mkdir(directory, { recursive: true });
  const loaderManifest = { ...manifest, id: 'dev.tiktools.worker-loader-smoke', name: 'Loader smoke', entry: 'index.js' };
  await writeFile(join(directory, 'plugin.json'), JSON.stringify(loaderManifest));
  await writeFile(join(directory, 'index.js'), source.replaceAll('dev.tiktools.worker-smoke', loaderManifest.id));
  const registry = createBuiltInNodeRegistry();
  const manager = new PluginManager(registry);
  const loader = new AutomationPluginLoader({
    rootDirectory: root,
    manager,
    capabilities: {
      http: {
        request: async (options) => ({ status: 200, ok: true, url: options.url, headers: {}, body: { answer: 42 } }),
      },
    },
  });
  try {
    const results = await loader.loadAll();
    if (!results[0]?.loaded || !manager.get('dev.tiktools.worker-loader-smoke') || manager.actionDefinitions('dev.tiktools.worker-loader-smoke').length !== 1) {
      throw new Error('Plugin loader did not register the fixture plugin.');
    }
    const implementation = registry.get('worker.smoke.sync');
    if (!implementation) throw new Error('Loaded plugin node was not added to the registry.');
    const result = await implementation.execute(context('worker.smoke.sync'));
    if (result.outputs?.value !== 42) throw new Error('Loaded plugin node returned an unexpected result.');
  } finally {
    await loader.stopAll();
    await rm(root, { recursive: true, force: true });
  }
}

function context(type: string): NodeExecutionContext {
  return {
    runId: 'smoke-run',
    workflowId: 'smoke-workflow',
    node: { id: type, type, version: 1, position: { x: 0, y: 0 }, config: {} },
    event: { id: 'smoke-event', type: 'tiktok.chat', timestamp: Date.now(), data: { value: 41 } },
    inputs: {},
    state: { get: () => undefined, set: () => undefined, delete: () => undefined },
    signal: new AbortController().signal,
    capabilities: {},
    log: (message) => console.log(`[worker] ${message}`),
  };
}

function actionContext(type: string) {
  return {
    action: { schemaVersion: 1 as const, id: 'smoke-action', typeId: type, name: 'Smoke action', enabled: true, config: {} },
    event: { id: 'smoke-event', type: 'tiktok.chat' as const, timestamp: Date.now(), data: { value: 41 } },
    capabilities: {},
    log: (message: string) => console.log(`[worker-action] ${message}`),
    publish: () => undefined,
  };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
