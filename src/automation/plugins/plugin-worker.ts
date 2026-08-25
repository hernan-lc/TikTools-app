import { createVm, type Vm } from 'napi-vm';
import { createConnection, type Socket } from 'node:net';

import type { JsonObject, JsonValue } from '../types.ts';
import {
  asJsonObject,
  asString,
  isJsonObject,
  isJsonValue,
  type PluginWorkerRequest,
} from './protocol.ts';

const MAX_LINE_BYTES = 4 * 1024 * 1024;
const MAX_PLUGIN_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_HANDLER_BYTES = 256 * 1024;
const LOOP_LIMIT = 1_000_000;

const SDK_MODULE = `
  export function registerNode(descriptor) { return __tiktools_register_node(descriptor); }
  export function log(...args) { return __tiktools_log(args); }
  export function capability(name, params) { return __tiktools_capability(name, params); }
`;

type Transport = {
  write(chunk: string): boolean;
  end?: () => void;
  destroy?: () => void;
};

type SandboxNode = {
  definition: JsonObject;
  handler: string;
  async: boolean;
};

type CapabilityWaiter = {
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
};

type WorkerEndpoint = {
  port?: number;
  token?: string;
};

export async function runPluginWorker(args: string[]): Promise<void> {
  const endpoint = readEndpoint(args);
  const vm = createVm();
  const nodes = new Map<string, SandboxNode>();
  const capabilityWaiters = new Map<string, CapabilityWaiter>();
  let activeExecutionId: string | undefined;
  let loaded = false;
  let requestSequence = 0;
  let inputBuffer = '';
  let transport: Transport | undefined;

  const send = (message: unknown): void => {
    if (!transport) throw new Error('Plugin worker transport is not connected.');
    transport.write(`${JSON.stringify(message)}\n`);
  };

  const requestCapability = (name: string, params: JsonValue): Promise<JsonValue> => {
    const requestId = `cap-${process.pid}-${++requestSequence}`;
    const executionId = activeExecutionId ?? 'unknown';
    const promise = new Promise<JsonValue>((resolve, reject) => {
      capabilityWaiters.set(requestId, { resolve, reject });
    });
    send({ type: 'capability.request', requestId, executionId, name, params });
    return promise;
  };

  vm.registerModule('@tiktools/sdk', SDK_MODULE);
  vm.exposeFunction('__tiktools_register_node', (value: unknown) => {
    registerNode(value, nodes);
    return null;
  });
  vm.exposeFunction('__tiktools_log', (value: unknown) => {
    const args = Array.isArray(value) ? value : [value];
    send({
      type: 'log',
      executionId: activeExecutionId,
      message: args.map(stringify).join(' '),
    });
    return null;
  });
  vm.exposeAsyncFunction('__tiktools_capability', (name: unknown, params: unknown) => {
    return requestCapability(String(name), isJsonValue(params) ? params : null);
  });
  vm.setLoopLimit(LOOP_LIMIT);

  const handleRequest = async (request: PluginWorkerRequest): Promise<void> => {
    if (request.type === 'capability.response') {
      const waiter = capabilityWaiters.get(request.requestId);
      if (!waiter) return;
      capabilityWaiters.delete(request.requestId);
      if (request.error) waiter.reject(new Error(request.error));
      else waiter.resolve(request.result === undefined ? null : request.result);
      return;
    }

    try {
      if (request.method === 'load') {
        if (loaded) throw new Error('Plugin worker has already loaded a plugin.');
        if (byteLength(request.source) > MAX_PLUGIN_SOURCE_BYTES) {
          throw new Error('Plugin entry source exceeds the 2 MB limit.');
        }
        vm.run(request.source);
        loaded = true;
        send({ type: 'response', id: request.id, ok: true, result: { nodes: [...nodes.values()] } });
        return;
      }

      if (request.method === 'execute') {
        if (!loaded) throw new Error('Plugin worker has not loaded a plugin.');
        const descriptor = nodes.get(request.nodeType);
        if (!descriptor) throw new Error(`Unknown sandbox node type: ${request.nodeType}`);
        activeExecutionId = request.executionId;
        try {
          const result = await executeNode(vm, descriptor, request.request);
          send({ type: 'response', id: request.id, ok: true, result });
        } finally {
          activeExecutionId = undefined;
        }
        return;
      }

      if (request.method === 'shutdown') {
        send({ type: 'response', id: request.id, ok: true, result: null });
        setTimeout(() => {
          transport?.end?.();
        }, 0);
      }
    } catch (error) {
      sendError(request.id, errorMessage(error), send);
    }
  };

  const consumeInput = (chunk: string | Buffer): void => {
    inputBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (byteLength(inputBuffer) > MAX_LINE_BYTES * 2) {
      sendError(undefined, 'Worker input buffer exceeded its limit.', send);
      transport?.destroy?.();
      return;
    }

    while (true) {
      const newline = inputBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = inputBuffer.slice(0, newline).trim();
      inputBuffer = inputBuffer.slice(newline + 1);
      if (!line) continue;
      if (byteLength(line) > MAX_LINE_BYTES) {
        sendError(undefined, 'Worker message exceeded its size limit.', send);
        continue;
      }

      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        sendError(undefined, 'Worker received invalid JSON.', send);
        continue;
      }
      if (!isWorkerRequest(value)) {
        sendError(undefined, 'Worker received an invalid protocol message.', send);
        continue;
      }
      void handleRequest(value);
    }
  };

  if (endpoint.port !== undefined && endpoint.token !== undefined) {
    const socket = await connectToHost(endpoint.port);
    transport = socket;
    socket.setEncoding('utf8');
    socket.on('data', consumeInput);
    socket.on('error', (error) => {
      process.stderr.write(`[tiktools-plugin-worker] ${error.message}\n`);
    });
    socket.on('close', () => {
      for (const waiter of capabilityWaiters.values()) waiter.reject(new Error('Plugin worker IPC closed.'));
      capabilityWaiters.clear();
    });
    socket.write(`${JSON.stringify({ type: 'hello', token: endpoint.token })}\n`);
    await waitForSocketClose(socket);
    return;
  }

  transport = process.stdout;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', consumeInput);
  await new Promise<void>((resolve) => {
    process.stdin.on('end', resolve);
  });
}

function readEndpoint(args: string[]): WorkerEndpoint {
  const portValue = readFlag(args, '--port');
  const token = readFlag(args, '--token');
  if (portValue === undefined && token === undefined) return {};
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || !token) {
    throw new Error('Plugin worker requires valid --port and --token arguments.');
  }
  return { port, token };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function connectToHost(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const onError = (error: Error): void => {
      socket.off('connect', onConnect);
      reject(error);
    };
    const onConnect = (): void => {
      socket.off('error', onError);
      resolve(socket);
    };
    socket.once('error', onError);
    socket.once('connect', onConnect);
  });
}

function waitForSocketClose(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    socket.once('close', resolve);
  });
}

function executeNode(
  vm: Vm,
  descriptor: SandboxNode,
  request: Extract<PluginWorkerRequest, { type: 'request'; method: 'execute' }>['request'],
): Promise<JsonObject> | JsonObject {
  vm.setGlobal('event', request.event);
  vm.setGlobal('inputs', request.inputs);
  vm.setGlobal('node', request.node);
  vm.setGlobal('runId', request.runId);
  vm.setGlobal('workflowId', request.workflowId);

  const source = descriptor.async
    ? `import { capability, log } from '@tiktools/sdk';\nasync function __tiktools_main(event, inputs, node) {\n${descriptor.handler}\n}\nJSON.stringify(await __tiktools_main(event, inputs, node))`
    : `import { capability, log } from '@tiktools/sdk';\nJSON.stringify((function (event, inputs, node) {\n${descriptor.handler}\n})(event, inputs, node))`;

  const run = async (): Promise<JsonObject> => {
    vm.setLoopLimit(LOOP_LIMIT);
    const raw = descriptor.async ? await vm.runAsync(source) : vm.run(source);
    const value = raw === 'undefined' ? null : JSON.parse(raw) as unknown;
    return normalizeNodeResult(value);
  };

  return run();
}

function registerNode(value: unknown, nodes: Map<string, SandboxNode>): void {
  const descriptor = asJsonObject(value, 'Node descriptor');
  const definition = asJsonObject(descriptor.definition, 'Node descriptor.definition');
  const type = asString(definition.type, 'Node definition.type');
  const handler = asString(descriptor.handler, 'Node descriptor.handler');
  if (!type || type.length > 160) throw new Error('Node definition.type is invalid.');
  if (byteLength(handler) > MAX_HANDLER_BYTES) throw new Error(`Node ${type} handler exceeds the 256 KB limit.`);
  if (nodes.has(type)) throw new Error(`Duplicate sandbox node type: ${type}`);
  validateDefinition(definition, type);
  nodes.set(type, {
    definition,
    handler,
    async: descriptor.isAsync === true || descriptor.async === true,
  });
}

function validateDefinition(definition: JsonObject, type: string): void {
  if (typeof definition.version !== 'number' || !Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Node ${type} has an invalid version.`);
  }
  for (const field of ['title', 'category', 'kind']) {
    if (typeof definition[field] !== 'string' || !definition[field].trim()) {
      throw new Error(`Node ${type} has an invalid ${field}.`);
    }
  }
  if (!Array.isArray(definition.inputs) || !Array.isArray(definition.outputs)) {
    throw new Error(`Node ${type} must declare inputs and outputs.`);
  }
  asJsonObject(definition.configSchema, `Node ${type} configSchema`);
}

function normalizeNodeResult(value: unknown): JsonObject {
  const object = asJsonObject(value, 'Plugin node result');
  const outputs: JsonObject = {};
  if (object.outputs !== undefined) {
    const rawOutputs = asJsonObject(object.outputs, 'Plugin node result.outputs');
    for (const [key, item] of Object.entries(rawOutputs)) {
      if (item !== undefined && isJsonValue(item)) outputs[key] = item;
    }
  }

  let next: string[] | undefined;
  if (object.next !== undefined) {
    if (!Array.isArray(object.next) || object.next.some((item) => typeof item !== 'string')) {
      throw new Error('Plugin node result.next must be an array of strings.');
    }
    next = object.next as string[];
  }

  return next ? { outputs, next } : { outputs };
}

function isWorkerRequest(value: unknown): value is PluginWorkerRequest {
  if (!isJsonObject(value)) return false;
  if (value.type === 'capability.response') {
    return typeof value.requestId === 'string'
      && (value.result === undefined || isJsonValue(value.result))
      && (value.error === undefined || typeof value.error === 'string');
  }
  if (value.type !== 'request' || typeof value.id !== 'string' || typeof value.method !== 'string') return false;
  if (value.method === 'load') return typeof value.source === 'string' && isJsonObject(value.manifest);
  if (value.method === 'execute') {
    return typeof value.nodeType === 'string' && typeof value.executionId === 'string' && isJsonObject(value.request);
  }
  return value.method === 'shutdown';
}

function sendError(id: string | undefined, message: string, send: (value: unknown) => void): void {
  if (id) send({ type: 'response', id, ok: false, error: message });
  else process.stderr.write(`[tiktools-plugin-worker] ${message}\n`);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
