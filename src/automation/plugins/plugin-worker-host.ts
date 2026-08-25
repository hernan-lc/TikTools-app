import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { basename, resolve } from 'node:path';

import type { AutomationPluginManifest } from './manifest.ts';
import type { PluginCapabilityBroker } from './capability-broker.ts';
import {
  asJsonObject,
  asNodeExecutionResult,
  asString,
  isJsonValue,
  isPluginWorkerResponse,
  type PluginWorkerRequest,
  type PluginWorkerResponse,
  type SandboxLoadResult,
  type SandboxNodeDescriptor,
} from './protocol.ts';
import type {
  AutomationEventType,
  ExecutionLogEntry,
  JsonObject,
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
  PortDefinition,
} from '../types.ts';
import { ensureAppPaths } from '../../platform/app-paths.ts';

export interface PluginWorkerHostOptions {
  manifest: AutomationPluginManifest;
  source: string;
  broker: PluginCapabilityBroker;
  startupTimeoutMs?: number;
  log?: (entry: Pick<ExecutionLogEntry, 'level' | 'message' | 'metadata'>) => void;
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Parent-side controller for a sandbox plugin. The worker only evaluates
 * napi-vm source and asks this object for explicitly granted capabilities.
 */
export class PluginWorkerHost {
  readonly #options: PluginWorkerHostOptions;
  readonly #pending = new Map<string, PendingCall>();
  readonly #contexts = new Map<string, NodeExecutionContext>();
  #process: ChildProcess | undefined;
  #server: Server | undefined;
  #socket: Socket | undefined;
  #socketBuffer = '';
  #token = '';
  #writeQueue: Promise<void> = Promise.resolve();
  #executionQueue: Promise<void> = Promise.resolve();
  #requestSequence = 0;
  #executionSequence = 0;
  #stopped = false;

  constructor(options: PluginWorkerHostOptions) {
    this.#options = options;
  }

  async start(): Promise<NodeDefinition[]> {
    if (this.#process) throw new Error(`Plugin worker is already running: ${this.#options.manifest.id}`);
    this.#stopped = false;
    this.#token = randomBytes(24).toString('hex');
    const { server, port, connection } = await createWorkerServer(this.#token);
    this.#server = server;
    const launch = getWorkerProcessArgs(port, this.#token);
    const child = spawn(launch.command, launch.args, {
      cwd: ensureAppPaths().root,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    this.#process = child;
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (text.trim()) this.#options.log?.({ level: 'warn', message: text.trim() });
    });
    child.on('error', (error) => this.#failPending(error));
    child.on('exit', (code) => {
      if (!this.#stopped && code !== 0) this.#failPending(new Error(`Plugin worker exited with code ${code}.`));
      else if (!this.#stopped) this.#failPending(new Error('Plugin worker exited unexpectedly.'));
    });

    try {
      this.#socket = await withTimeout(connection, this.#options.startupTimeoutMs ?? 15_000, 'Plugin worker connection');
      this.#attachSocket(this.#socket);
      const raw = await this.#call({
        type: 'request',
        id: '',
        method: 'load',
        manifest: this.#options.manifest,
        source: this.#options.source,
      });
      const result = parseLoadResult(raw);
      return result.nodes.map((descriptor) => normalizeDefinition(descriptor, this.#options.manifest.id));
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const run = this.#executionQueue.then(() => this.#executeOne(context));
    this.#executionQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #executeOne(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    if (!this.#process) throw new Error(`Plugin worker is not running: ${this.#options.manifest.id}`);
    const executionId = `${this.#options.manifest.id}-execution-${++this.#executionSequence}`;
    const request: PluginWorkerRequest = {
      type: 'request',
      id: '',
      method: 'execute',
      nodeType: context.node.type,
      executionId,
      request: {
        runId: context.runId,
        workflowId: context.workflowId,
        node: context.node,
        event: context.event,
        inputs: withoutUndefined(context.inputs),
      },
    };
    this.#contexts.set(executionId, context);
    try {
      const raw = await this.#call(request);
      return asNodeExecutionResult(raw);
    } finally {
      this.#contexts.delete(executionId);
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    const child = this.#process;
    this.#contexts.clear();
    if (!child) {
      this.#failPending(new Error('Plugin worker stopped.'));
      return;
    }
    try {
      await this.#call({ type: 'request', id: '', method: 'shutdown' }, 2_000);
    } catch {
      // A crashed worker is already stopped; killing it below is idempotent.
    }
    this.#socket?.end();
    this.#socket?.destroy();
    this.#socket = undefined;
    this.#server?.close();
    this.#server = undefined;
    if (!child.killed) child.kill();
    await waitForExit(child, 2_000);
    this.#process = undefined;
    this.#failPending(new Error('Plugin worker stopped.'));
  }

  #attachSocket(socket: Socket): void {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string | Buffer) => this.#consumeOutput(typeof chunk === 'string' ? chunk : chunk.toString('utf8')));
    socket.on('error', (error) => this.#failPending(error));
    socket.on('close', () => {
      if (!this.#stopped) this.#failPending(new Error('Plugin worker IPC connection closed.'));
    });
  }

  #consumeOutput(chunk: string): void {
    this.#socketBuffer += chunk;
    if (this.#socketBuffer.length > 8 * 1024 * 1024) {
      this.#failPending(new Error('Plugin worker output buffer exceeded its limit.'));
      this.#socketBuffer = '';
      return;
    }
    while (true) {
      const newline = this.#socketBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.#socketBuffer.slice(0, newline).trim();
      this.#socketBuffer = this.#socketBuffer.slice(newline + 1);
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        this.#failPending(new Error('Plugin worker emitted invalid JSON.'));
        continue;
      }
      if (!isPluginWorkerResponse(parsed)) {
        this.#failPending(new Error('Plugin worker emitted an invalid protocol message.'));
        continue;
      }
      void this.#handleResponse(parsed);
    }
  }

  async #handleResponse(message: PluginWorkerResponse): Promise<void> {
    if (message.type === 'response') {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
      return;
    }
    if (message.type === 'log') {
      const context = message.executionId ? this.#contexts.get(message.executionId) : undefined;
      if (context) context.log(message.message, message.metadata);
      else this.#options.log?.({ level: 'info', message: message.message, metadata: message.metadata });
      return;
    }
    if (message.type === 'capability.request') {
      const context = this.#contexts.get(message.executionId);
      try {
        if (!context) throw new Error('Capability request is not associated with an active execution.');
        const result = await this.#options.broker.invoke(this.#options.manifest.id, message.name, message.params);
        await this.#send({ type: 'capability.response', requestId: message.requestId, result });
      } catch (error) {
        await this.#send({
          type: 'capability.response',
          requestId: message.requestId,
          error: errorMessage(error),
        });
      }
    }
  }

  #call(request: PluginWorkerRequest, timeoutMs = this.#options.startupTimeoutMs ?? 15_000): Promise<unknown> {
    const id = `${this.#options.manifest.id}-request-${++this.#requestSequence}`;
    const message = { ...request, id } as PluginWorkerRequest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Plugin worker request timed out: ${request.type === 'request' ? request.method : request.type}.`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      void this.#send(message).catch((error: unknown) => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  #send(message: PluginWorkerRequest): Promise<void> {
    this.#writeQueue = this.#writeQueue.then(async () => {
      const socket = this.#socket;
      if (!socket || socket.destroyed) throw new Error('Plugin worker IPC is not connected.');
      const line = `${JSON.stringify(message)}\n`;
      if (!socket.write(line)) await waitForDrain(socket);
    });
    return this.#writeQueue;
  }

  #failPending(error: Error): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(id);
    }
  }
}

function getWorkerProcessArgs(port: number, token: string): { command: string; args: string[] } {
  const workerArgs = ['--plugin-worker', '--port', String(port), '--token', token];
  if (Bun.isStandaloneExecutable || basename(process.execPath).toLowerCase() === 'tiktools.exe') {
    return { command: process.execPath, args: workerArgs };
  }

  const entrypoint = process.argv[1]?.endsWith('index.ts')
    ? process.argv[1]
    : resolve(import.meta.dir, '../../../index.ts');
  return { command: process.execPath, args: [entrypoint, ...workerArgs] };
}

function waitForDrain(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off('drain', onDrain);
      socket.off('error', onError);
    };
    socket.once('drain', onDrain);
    socket.once('error', onError);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      cleanup();
      resolve();
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      child.off('exit', onExit);
    };
    child.once('exit', onExit);
  });
}

async function createWorkerServer(token: string): Promise<{ server: Server; port: number; connection: Promise<Socket> }> {
  const server = createServer();
  const connection = new Promise<Socket>((resolve, reject) => {
    server.on('connection', (socket) => {
      socket.setEncoding('utf8');
      let buffer = '';
      let handshaken = false;
      const onData = (chunk: string | Buffer): void => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        while (true) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) return;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let value: unknown;
          try {
            value = JSON.parse(line) as unknown;
          } catch {
            socket.destroy(new Error('Invalid worker handshake JSON.'));
            reject(new Error('Plugin worker sent an invalid handshake.'));
            return;
          }
          if (!handshaken) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
              socket.destroy(new Error('Plugin worker handshake must be an object.'));
              reject(new Error('Plugin worker handshake was rejected.'));
              return;
            }
            const object = value as Record<string, unknown>;
            if (object.type !== 'hello' || object.token !== token) {
              socket.destroy(new Error('Plugin worker handshake token was rejected.'));
              reject(new Error('Plugin worker handshake was rejected.'));
              return;
            }
            handshaken = true;
            socket.off('data', onData);
            server.close();
            resolve(socket);
            return;
          }
        }
      };
      socket.on('data', onData);
      socket.on('error', (error) => {
        if (!handshaken) reject(error);
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Plugin worker IPC server did not receive a TCP port.');
  }
  return { server, port: address.port, connection };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseLoadResult(value: unknown): SandboxLoadResult {
  const object = asJsonObject(value, 'Plugin load result');
  if (!Array.isArray(object.nodes)) throw new Error('Plugin load result.nodes must be an array.');
  return { nodes: object.nodes.map(parseNodeDescriptor) };
}

function parseNodeDescriptor(value: unknown): SandboxNodeDescriptor {
  const object = asJsonObject(value, 'Sandbox node descriptor');
  const definition = asJsonObject(object.definition, 'Sandbox node definition');
  return {
    definition: definition as never,
    handler: asString(object.handler, 'Sandbox node handler'),
    async: object.async === true,
  };
}

function normalizeDefinition(descriptor: SandboxNodeDescriptor, pluginId: string): NodeDefinition {
  const definition = descriptor.definition as unknown as JsonObject;
  const type = asString(definition.type, 'Sandbox node definition.type');
  const version = definition.version;
  const title = asString(definition.title, `Sandbox node ${type} title`);
  const category = asString(definition.category, `Sandbox node ${type} category`);
  const kind = asString(definition.kind, `Sandbox node ${type} kind`) as NodeDefinition['kind'];
  if (!type.trim() || type.length > 160 || !title.trim() || !category.trim()) throw new Error(`Sandbox node ${type} metadata is invalid.`);
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new Error(`Sandbox node ${type} version is invalid.`);
  if (!['trigger', 'condition', 'transform', 'action', 'control'].includes(kind)) throw new Error(`Sandbox node ${type} kind is invalid.`);
  if (!asJsonObject(definition.configSchema, `Sandbox node ${type} configSchema`)) throw new Error(`Sandbox node ${type} configSchema is invalid.`);
  const inputs = normalizePorts(definition.inputs, `Sandbox node ${type} inputs`);
  const outputs = normalizePorts(definition.outputs, `Sandbox node ${type} outputs`);
  const requiredCapabilities = normalizeStrings(definition.requiredCapabilities, `Sandbox node ${type} requiredCapabilities`);
  return {
    type,
    version,
    pluginId,
    title,
    category,
    kind,
    inputs,
    outputs,
    configSchema: definition.configSchema as JsonObject,
    requiredCapabilities,
    triggerTypes: normalizeTriggerTypes(definition.triggerTypes),
  };
}

function normalizePorts(value: unknown, label: string): PortDefinition[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((raw, index) => {
    const port = asJsonObject(raw, `${label}[${index}]`);
    const name = asString(port.name, `${label}[${index}].name`);
    const title = asString(port.title, `${label}[${index}].title`);
    const kind = port.kind;
    if (!name.trim() || !title.trim() || (kind !== 'flow' && kind !== 'data')) {
      throw new Error(`${label}[${index}] is invalid.`);
    }
    const valueType = port.valueType;
    const validValueType = valueType === undefined
      || valueType === 'string'
      || valueType === 'number'
      || valueType === 'boolean'
      || valueType === 'json'
      || valueType === 'event'
      || valueType === 'bytes'
      || valueType === 'audio-ref'
      || valueType === 'secret-ref';
    if (!validValueType || (port.required !== undefined && typeof port.required !== 'boolean') || (port.multiple !== undefined && typeof port.multiple !== 'boolean')) {
      throw new Error(`${label}[${index}] is invalid.`);
    }
    return {
      name,
      title,
      kind,
      valueType: valueType as PortDefinition['valueType'],
      required: port.required as boolean | undefined,
      multiple: port.multiple as boolean | undefined,
    };
  });
}

function normalizeStrings(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(`${label} must be an array of strings.`);
  return value as string[];
}

function normalizeTriggerTypes(value: unknown): AutomationEventType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Sandbox node triggerTypes must be an array.');
  const known: AutomationEventType[] = [
    'tiktok.chat',
    'tiktok.gift',
    'tiktok.like',
    'tiktok.follow',
    'tiktok.share',
    'tiktok.join',
    'tiktok.social',
    'tiktok.room_stats',
    'tiktok.connected',
    'tiktok.disconnected',
    'points.awarded',
  ];
  return value.filter((entry): entry is AutomationEventType => typeof entry === 'string' && known.includes(entry as AutomationEventType));
}

function withoutUndefined(inputs: Record<string, unknown>): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (value !== undefined && isJsonValue(value)) result[key] = value;
  }
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
