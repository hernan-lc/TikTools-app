import { resolve } from 'node:path';

import { PluginCapabilityBroker } from '../src/automation/plugins/capability-broker.ts';
import { createBuiltInNodeRegistry } from '../src/automation/nodes/builtins.ts';
import { PluginManager } from '../src/automation/plugins/plugin-manager.ts';
import { PluginWorkerHost } from '../src/automation/plugins/plugin-worker-host.ts';
import type { NodeExecutionContext } from '../src/automation/types.ts';

const executable = resolve(process.cwd(), 'dist', 'TikTools.exe');
const manifest = {
  manifestVersion: 1 as const,
  id: 'dev.tiktools.compiled-integration-smoke',
  name: 'Compiled integration smoke test',
  version: '1.0.0',
  apiVersion: 1 as const,
  executionMode: 'sandbox' as const,
  permissions: { capabilities: ['http.request'], network: ['api.example.test'] },
};
const source = `
import { registerNode } from '@tiktools/sdk';
registerNode({
  definition: { type: 'compiled.integration.node', version: 1, title: 'Compiled integration', category: 'Tests', kind: 'action', inputs: [], outputs: [], configSchema: {}, requiredCapabilities: ['http.request'] },
  isAsync: true,
  handler: 'const response = await capability("http.request", { method: "GET", url: "https://api.example.test/data" }); return { outputs: { value: response.body.answer }, next: ["success"] };'
});
`;

const manager = new PluginManager(createBuiltInNodeRegistry());
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
  getManifest: (pluginId) => manager.get(pluginId),
});
const worker = new PluginWorkerHost({ manifest, source, broker, executablePath: executable });

try {
  const definitions = await worker.start();
  manager.registerSandbox({
    manifest,
    nodes: definitions.nodes.map((definition) => ({
      definition,
      execute: (executionContext) => worker.execute(executionContext),
    })),
  });
  const result = await worker.execute(context());
  if (definitions.nodes.length !== 1 || result.outputs?.value !== 42 || result.next?.[0] !== 'success') {
    throw new Error('Compiled PluginWorkerHost integration returned an unexpected result.');
  }
  console.log('Compiled PluginWorkerHost + PluginCapabilityBroker smoke test passed.');
} finally {
  await manager.unregisterAsync(manifest.id);
  await worker.stop();
}

function context(): NodeExecutionContext {
  return {
    runId: 'compiled-integration-smoke',
    workflowId: 'compiled-integration-smoke',
    node: {
      id: 'compiled.integration.node',
      type: 'compiled.integration.node',
      version: 1,
      position: { x: 0, y: 0 },
      config: {},
    },
    event: {
      id: 'event-1',
      type: 'tiktok.chat',
      timestamp: Date.now(),
      data: {},
    },
    inputs: {},
    state: { get: () => undefined, set: () => undefined, delete: () => undefined },
    signal: new AbortController().signal,
    capabilities: {},
    log: () => undefined,
  };
}
