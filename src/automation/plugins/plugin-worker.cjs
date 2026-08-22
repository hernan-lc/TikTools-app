#!/usr/bin/env node

const { createVm } = require('napi-vm');
const net = require('node:net');

const MAX_LINE_BYTES = 4 * 1024 * 1024;
const MAX_PLUGIN_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_HANDLER_BYTES = 256 * 1024;
const SDK_MODULE = `
  export function registerNode(descriptor) { return __tiktools_register_node(descriptor); }
  export function log(...args) { return __tiktools_log(args); }
  export function capability(name, params) { return __tiktools_capability(name, params); }
`;

const vm = createVm();
const nodes = new Map();
const capabilityWaiters = new Map();
let activeExecutionId;
let loaded = false;
let requestSequence = 0;
let inputBuffer = '';
let transport = process.stdout;

vm.registerModule('@tiktools/sdk', SDK_MODULE);
vm.exposeFunction('__tiktools_register_node', (value) => {
  registerNode(value);
  return null;
});
vm.exposeFunction('__tiktools_log', (value) => {
  const args = Array.isArray(value) ? value : [value];
  send({ type: 'log', executionId: activeExecutionId, message: args.map(stringify).join(' ') });
  return null;
});
vm.exposeAsyncFunction('__tiktools_capability', (name, params) => {
  return requestCapability(String(name), isJsonValue(params) ? params : null);
});
vm.setLoopLimit(1_000_000);

const portIndex = process.argv.indexOf('--port');
const tokenIndex = process.argv.indexOf('--token');
if (portIndex >= 0 && tokenIndex >= 0) {
  const port = Number(process.argv[portIndex + 1]);
  const token = process.argv[tokenIndex + 1];
  const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
    transport = socket;
    socket.write(`${JSON.stringify({ type: 'hello', token })}\n`);
  });
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => consumeInput(chunk));
  socket.on('error', (error) => {
    process.stderr.write(`[tiktools-plugin-worker] ${error.message}\n`);
    process.exit(1);
  });
  socket.on('close', () => process.exit(0));
} else {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => consumeInput(chunk));
  process.stdin.on('end', () => process.exit(0));
}

function consumeInput(chunk) {
  inputBuffer += chunk;
  if (Buffer.byteLength(inputBuffer) > MAX_LINE_BYTES * 2) {
    sendError(undefined, 'Worker input buffer exceeded its limit.');
    process.exit(1);
  }
  while (true) {
    const newline = inputBuffer.indexOf('\n');
    if (newline < 0) return;
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line) continue;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      sendError(undefined, 'Worker message exceeded its size limit.');
      continue;
    }
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      sendError(undefined, 'Worker received invalid JSON.');
      continue;
    }
    if (!isWorkerRequest(request)) {
      sendError(undefined, 'Worker received an invalid protocol message.');
      continue;
    }
    void handleRequest(request);
  }
}

async function handleRequest(request) {
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
      if (Buffer.byteLength(request.source) > MAX_PLUGIN_SOURCE_BYTES) throw new Error('Plugin entry source exceeds the 2 MB limit.');
      vm.run(request.source);
      loaded = true;
      send({ type: 'response', id: request.id, ok: true, result: { nodes: [...nodes.values()] } });
      return;
    }
    if (request.method === 'execute') {
      if (!loaded) throw new Error('Plugin worker has not loaded a plugin.');
      const descriptor = nodes.get(request.nodeType);
      if (!descriptor) throw new Error(`Unknown sandbox node type: ${request.nodeType}`);
      const result = await executeNode(descriptor, request.executionId, request.request);
      send({ type: 'response', id: request.id, ok: true, result });
      return;
    }
    if (request.method === 'shutdown') {
      send({ type: 'response', id: request.id, ok: true, result: null });
      setTimeout(() => process.exit(0), 0);
    }
  } catch (error) {
    sendError(request.id, errorMessage(error));
  }
}

async function executeNode(descriptor, executionId, request) {
  activeExecutionId = executionId;
  vm.setGlobal('event', request.event);
  vm.setGlobal('inputs', request.inputs);
  vm.setGlobal('node', request.node);
  vm.setGlobal('runId', request.runId);
  vm.setGlobal('workflowId', request.workflowId);
  vm.setLoopLimit(1_000_000);
  try {
    const call = descriptor.async
      ? `(async function (event, inputs, node) {\n${descriptor.handler}\n})(event, inputs, node)`
      : `(function (event, inputs, node) {\n${descriptor.handler}\n})(event, inputs, node)`;
    const source = descriptor.async
      ? `import { capability, log } from '@tiktools/sdk';\nasync function __tiktools_main(event, inputs, node) {\n${descriptor.handler}\n}\nJSON.stringify(await __tiktools_main(event, inputs, node))`
      : `import { capability, log } from '@tiktools/sdk';\nJSON.stringify(${call})`;
    const raw = descriptor.async ? await vm.runAsync(source) : vm.run(source);
    const value = raw === 'undefined' ? null : JSON.parse(raw);
    return normalizeNodeResult(value);
  } finally {
    activeExecutionId = undefined;
  }
}

function registerNode(value) {
  const descriptor = asObject(value, 'Node descriptor');
  const definition = asObject(descriptor.definition, 'Node descriptor.definition');
  const type = asString(definition.type, 'Node definition.type');
  const handler = asString(descriptor.handler, 'Node descriptor.handler');
  if (!type || type.length > 160) throw new Error('Node definition.type is invalid.');
  if (Buffer.byteLength(handler) > MAX_HANDLER_BYTES) throw new Error(`Node ${type} handler exceeds the 256 KB limit.`);
  if (nodes.has(type)) throw new Error(`Duplicate sandbox node type: ${type}`);
  validateDefinition(definition, type);
  nodes.set(type, { definition, handler, async: descriptor.isAsync === true || descriptor.async === true });
}

function validateDefinition(definition, type) {
  if (!Number.isInteger(definition.version) || definition.version < 1) throw new Error(`Node ${type} has an invalid version.`);
  for (const field of ['title', 'category', 'kind']) {
    if (typeof definition[field] !== 'string' || !definition[field].trim()) throw new Error(`Node ${type} has an invalid ${field}.`);
  }
  if (!Array.isArray(definition.inputs) || !Array.isArray(definition.outputs)) throw new Error(`Node ${type} must declare inputs and outputs.`);
  asObject(definition.configSchema, `Node ${type} configSchema`);
}

function requestCapability(name, params) {
  const requestId = `cap-${process.pid}-${++requestSequence}`;
  const executionId = activeExecutionId || 'unknown';
  const promise = new Promise((resolve, reject) => capabilityWaiters.set(requestId, { resolve, reject }));
  send({ type: 'capability.request', requestId, executionId, name, params });
  return promise;
}

function normalizeNodeResult(value) {
  const object = asObject(value, 'Plugin node result');
  const outputs = {};
  if (object.outputs !== undefined) {
    const rawOutputs = asObject(object.outputs, 'Plugin node result.outputs');
    for (const [key, item] of Object.entries(rawOutputs)) if (item !== undefined && isJsonValue(item)) outputs[key] = item;
  }
  let next;
  if (object.next !== undefined) {
    if (!Array.isArray(object.next) || object.next.some((item) => typeof item !== 'string')) throw new Error('Plugin node result.next must be an array of strings.');
    next = object.next;
  }
  return { outputs, next };
}

function send(message) {
  transport.write(`${JSON.stringify(message)}\n`);
}

function sendError(id, message) {
  if (id) send({ type: 'response', id, ok: false, error: message });
  else process.stderr.write(`[tiktools-plugin-worker] ${message}\n`);
}

function isWorkerRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.type === 'capability.response') return typeof value.requestId === 'string' && (value.result === undefined || isJsonValue(value.result)) && (value.error === undefined || typeof value.error === 'string');
  if (value.type !== 'request' || typeof value.id !== 'string' || typeof value.method !== 'string') return false;
  if (value.method === 'load') return typeof value.source === 'string' && Boolean(value.manifest);
  if (value.method === 'execute') return typeof value.nodeType === 'string' && typeof value.executionId === 'string' && Boolean(value.request);
  return value.method === 'shutdown';
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function asString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function isJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return Boolean(value) && typeof value === 'object' && Object.values(value).every((item) => item === undefined || isJsonValue(item));
}

function stringify(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
