import { NodeRegistry } from '../node-registry.ts';
import type {
  AutomationEvent,
  JsonObject,
  JsonValue,
  NodeDefinition,
  NodeExecutionContext,
  NodeImplementation,
  NodeExecutionResult,
  WorkflowNode,
} from '../types.ts';

const FLOW_OUTPUT = { name: 'flow', title: 'Flow', kind: 'flow' as const };

export function createBuiltInNodeRegistry(): NodeRegistry {
  const registry = new NodeRegistry();
  for (const implementation of builtInNodes()) registry.register(implementation);
  return registry;
}

export function builtInNodes(): NodeImplementation[] {
  return [
    eventTriggerNode(),
    compareNode(),
    templateNode(),
    scriptNode(),
    delayNode(),
    cooldownNode(),
    logNode(),
    httpNode(),
    playSoundNode(),
    ttsNode(),
    adjustPointsNode(),
  ];
}

function eventTriggerNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'trigger.event',
    version: 1,
    pluginId: 'core',
    title: 'Event Trigger',
    category: 'Triggers',
    kind: 'trigger',
    inputs: [],
    outputs: [
      FLOW_OUTPUT,
      { name: 'event', title: 'Event', kind: 'data', valueType: 'event' },
      { name: 'data', title: 'Data', kind: 'data', valueType: 'json' },
      { name: 'user', title: 'User', kind: 'data', valueType: 'json' },
    ],
    configSchema: {
      type: 'object',
      properties: {
        eventType: { type: 'string' },
      },
      required: ['eventType'],
    },
  };

  return {
    definition,
    matchesTrigger: (node, event) => {
      const eventType = node.config.eventType;
      return eventType === '*' || eventType === event.type;
    },
    execute: ({ event }): NodeExecutionResult => {
      const outputs: Record<string, JsonValue> = {
        event,
        data: event.data,
      };
      if (event.user) outputs.user = event.user;
      return { outputs, next: ['flow'] };
    },
  };
}

function compareNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'condition.compare',
    version: 1,
    pluginId: 'core',
    title: 'Compare',
    category: 'Conditions',
    kind: 'condition',
    inputs: [
      FLOW_INPUT,
      { name: 'left', title: 'Left', kind: 'data', valueType: 'json' },
      { name: 'right', title: 'Right', kind: 'data', valueType: 'json' },
    ],
    outputs: [
      { name: 'true', title: 'True', kind: 'flow' },
      { name: 'false', title: 'False', kind: 'flow' },
      { name: 'result', title: 'Result', kind: 'data', valueType: 'boolean' },
    ],
    configSchema: {
      type: 'object',
      properties: {
        leftPath: { type: 'string' },
        operator: { type: 'string' },
        right: {},
      },
    },
  };

  return {
    definition,
    execute: (context): NodeExecutionResult => {
      const left = context.inputs.left ?? readContextPath(context, context.node.config.leftPath);
      const right = context.inputs.right ?? context.node.config.right;
      const operator = typeof context.node.config.operator === 'string'
        ? context.node.config.operator
        : 'equals';
      const result = compare(left, right, operator);
      return {
        outputs: { result },
        next: [result ? 'true' : 'false'],
      };
    },
  };
}

function templateNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'transform.template',
    version: 1,
    pluginId: 'core',
    title: 'Template',
    category: 'Transforms',
    kind: 'transform',
    inputs: [FLOW_INPUT, { name: 'value', title: 'Value', kind: 'data', valueType: 'json' }],
    outputs: [
      FLOW_OUTPUT,
      { name: 'value', title: 'Value', kind: 'data', valueType: 'string' },
    ],
    configSchema: {
      type: 'object',
      properties: { template: { type: 'string' } },
      required: ['template'],
    },
  };

  return {
    definition,
    execute: (context): NodeExecutionResult => {
      const template = typeof context.node.config.template === 'string'
        ? context.node.config.template
        : '';
      const value = renderTemplate(template, context);
      return { outputs: { value }, next: ['flow'] };
    },
  };
}

function scriptNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'transform.script',
    version: 1,
    pluginId: 'core',
    title: 'Script',
    category: 'Transforms',
    kind: 'transform',
    inputs: [FLOW_INPUT, { name: 'value', title: 'Value', kind: 'data', valueType: 'json' }],
    outputs: [
      FLOW_OUTPUT,
      { name: 'value', title: 'Value', kind: 'data', valueType: 'json' },
    ],
    configSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        loopLimit: { type: 'number' },
      },
      required: ['source'],
    },
    requiredCapabilities: ['vm.script'],
  };

  return {
    definition,
    execute: (context): NodeExecutionResult => {
      const vm = context.capabilities.vm;
      if (!vm) throw new Error('Script capability is not available to this workflow.');
      const source = typeof context.node.config.source === 'string'
        ? context.node.config.source
        : 'return inputs.value;';
      const inputs: JsonObject = {};
      for (const [key, value] of Object.entries(context.inputs)) {
        if (value !== undefined) inputs[key] = value;
      }
      const value = vm.evaluate(source, { event: context.event, inputs }, {
        scopeId: `${context.workflowId}:${context.node.id}`,
        loopLimit: typeof context.node.config.loopLimit === 'number'
          ? context.node.config.loopLimit
          : undefined,
        log: (message) => context.log(message),
      });
      return { outputs: { value }, next: ['flow'] };
    },
  };
}

function delayNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'control.delay',
    version: 1,
    pluginId: 'core',
    title: 'Delay',
    category: 'Control',
    kind: 'control',
    inputs: [FLOW_INPUT],
    outputs: [FLOW_OUTPUT],
    configSchema: {
      type: 'object',
      properties: { delayMs: { type: 'number' } },
      required: ['delayMs'],
    },
  };

  return {
    definition,
    execute: async (context): Promise<NodeExecutionResult> => {
      const rawDelay = context.node.config.delayMs;
      const delayMs = typeof rawDelay === 'number' ? Math.max(0, Math.min(rawDelay, 3_600_000)) : 0;
      await wait(delayMs, context.signal);
      return { next: ['flow'] };
    },
  };
}

function cooldownNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'control.cooldown',
    version: 1,
    pluginId: 'core',
    title: 'Cooldown',
    category: 'Control',
    kind: 'control',
    inputs: [FLOW_INPUT],
    outputs: [
      { name: 'ready', title: 'Ready', kind: 'flow' },
      { name: 'blocked', title: 'Blocked', kind: 'flow' },
      { name: 'remainingMs', title: 'Remaining', kind: 'data', valueType: 'number' },
    ],
    configSchema: {
      type: 'object',
      properties: {
        durationMs: { type: 'number' },
        key: { type: 'string' },
      },
      required: ['durationMs'],
    },
  };

  return {
    definition,
    execute: (context): NodeExecutionResult => {
      const durationMs = typeof context.node.config.durationMs === 'number'
        ? Math.max(0, context.node.config.durationMs)
        : 0;
      const keyTemplate = typeof context.node.config.key === 'string'
        ? context.node.config.key
        : '{{ event.user.uniqueId }}';
      const key = `${context.node.id}:${renderTemplate(keyTemplate, context)}`;
      const now = Date.now();
      const last = context.state.get(key);
      const lastAt = typeof last === 'number' ? last : 0;
      const remainingMs = Math.max(0, durationMs - (now - lastAt));
      if (remainingMs > 0) {
        return { outputs: { remainingMs }, next: ['blocked'] };
      }
      context.state.set(key, now);
      return { outputs: { remainingMs: 0 }, next: ['ready'] };
    },
  };
}

function logNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'action.log',
    version: 1,
    pluginId: 'core',
    title: 'Log',
    category: 'Actions',
    kind: 'action',
    inputs: [FLOW_INPUT, { name: 'value', title: 'Value', kind: 'data', valueType: 'json' }],
    outputs: [FLOW_OUTPUT],
    configSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
  };

  return {
    definition,
    execute: (context): NodeExecutionResult => {
      const configured = typeof context.node.config.message === 'string'
        ? renderTemplate(context.node.config.message, context)
        : '';
      const value = context.inputs.value;
      const message = configured || (value === undefined ? '' : stringify(value));
      context.log(message, value === undefined ? undefined : { value });
      return { next: ['flow'] };
    },
  };
}

function httpNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'action.http',
    version: 1,
    pluginId: 'core',
    title: 'HTTP Request',
    category: 'Actions',
    kind: 'action',
    inputs: [
      FLOW_INPUT,
      { name: 'url', title: 'URL', kind: 'data', valueType: 'string' },
      { name: 'body', title: 'Body', kind: 'data', valueType: 'json' },
    ],
    outputs: [
      { name: 'success', title: 'Success', kind: 'flow' },
      { name: 'error', title: 'Error', kind: 'flow' },
      { name: 'status', title: 'Status', kind: 'data', valueType: 'number' },
      { name: 'ok', title: 'OK', kind: 'data', valueType: 'boolean' },
      { name: 'headers', title: 'Headers', kind: 'data', valueType: 'json' },
      { name: 'body', title: 'Response', kind: 'data', valueType: 'json' },
      { name: 'errorMessage', title: 'Error Message', kind: 'data', valueType: 'string' },
    ],
    configSchema: {
      type: 'object',
      properties: {
        method: { type: 'string' },
        url: { type: 'string' },
        headers: { type: 'object' },
        body: {},
        timeoutMs: { type: 'number' },
        maxResponseBytes: { type: 'number' },
        responseType: { type: 'string' },
        redirect: { type: 'string' },
        maxRedirects: { type: 'number' },
        allowedHosts: { type: 'array' },
        allowPrivateNetwork: { type: 'boolean' },
      },
      required: ['url'],
    },
    requiredCapabilities: ['http.request'],
  };

  return {
    definition,
    execute: async (context): Promise<NodeExecutionResult> => {
      const http = context.capabilities.http;
      if (!http) throw new Error('HTTP capability is not available to this workflow.');

      const configuredUrl = typeof context.node.config.url === 'string'
        ? renderTemplate(context.node.config.url, context)
        : '';
      const urlValue = context.inputs.url ?? configuredUrl;
      const url = typeof urlValue === 'string' ? urlValue : stringify(urlValue);
      const headers = renderHeaders(context.node.config.headers, context);
      const configuredBody = context.inputs.body ?? context.node.config.body;
      const body = configuredBody === undefined || configuredBody === null
        ? undefined
        : typeof configuredBody === 'string'
          ? renderTemplate(configuredBody, context)
          : stringify(configuredBody);

      try {
        const response = await http.request({
          method: typeof context.node.config.method === 'string' ? context.node.config.method : 'GET',
          url,
          headers,
          body,
          timeoutMs: typeof context.node.config.timeoutMs === 'number' ? context.node.config.timeoutMs : undefined,
          maxResponseBytes: typeof context.node.config.maxResponseBytes === 'number' ? context.node.config.maxResponseBytes : undefined,
          responseType: typeof context.node.config.responseType === 'string'
            ? context.node.config.responseType as 'auto' | 'json' | 'text' | 'bytes'
            : 'auto',
          redirect: context.node.config.redirect === 'follow' ? 'follow' : 'error',
          maxRedirects: typeof context.node.config.maxRedirects === 'number' ? context.node.config.maxRedirects : undefined,
          allowedHosts: Array.isArray(context.node.config.allowedHosts)
            ? context.node.config.allowedHosts.filter((value): value is string => typeof value === 'string')
            : undefined,
          allowPrivateNetwork: context.node.config.allowPrivateNetwork === true,
        });
        return {
          outputs: {
            status: response.status,
            ok: response.ok,
            headers: response.headers,
            body: response.body,
          },
          next: [response.ok ? 'success' : 'error'],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.log(`HTTP request failed: ${message}`);
        return {
          outputs: { ok: false, errorMessage: message },
          next: ['error'],
        };
      }
    },
  };
}

function playSoundNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'action.play-sound',
    version: 1,
    pluginId: 'core',
    title: 'Play Sound',
    category: 'Actions',
    kind: 'action',
    inputs: [
      FLOW_INPUT,
      { name: 'filePath', title: 'File', kind: 'data', valueType: 'string' },
    ],
    outputs: [
      { name: 'success', title: 'Success', kind: 'flow' },
      { name: 'error', title: 'Error', kind: 'flow' },
      { name: 'playback', title: 'Playback', kind: 'data', valueType: 'json' },
      { name: 'errorMessage', title: 'Error Message', kind: 'data', valueType: 'string' },
    ],
    configSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        volume: { type: 'number' },
        overlap: { type: 'string' },
      },
      required: ['filePath'],
    },
    requiredCapabilities: ['audio.play'],
  };

  return {
    definition,
    execute: async (context): Promise<NodeExecutionResult> => {
      const audio = context.capabilities.audio;
      if (!audio) throw new Error('Audio capability is not available to this workflow.');
      const configuredPath = typeof context.node.config.filePath === 'string'
        ? renderTemplate(context.node.config.filePath, context)
        : '';
      const pathValue = context.inputs.filePath ?? configuredPath;
      const path = typeof pathValue === 'string' ? pathValue : stringify(pathValue);
      try {
        const playback = await audio.playFile(path, {
          volume: typeof context.node.config.volume === 'number' ? context.node.config.volume : undefined,
          overlap: context.node.config.overlap === 'restart' || context.node.config.overlap === 'drop'
            ? context.node.config.overlap
            : 'allow',
        });
        return { outputs: { playback }, next: ['success'] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.log(`Audio playback failed: ${message}`);
        return { outputs: { errorMessage: message }, next: ['error'] };
      }
    },
  };
}

function ttsNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'action.tts',
    version: 1,
    pluginId: 'core',
    title: 'Text to Speech',
    category: 'Actions',
    kind: 'action',
    inputs: [
      FLOW_INPUT,
      { name: 'text', title: 'Text', kind: 'data', valueType: 'string' },
    ],
    outputs: [
      { name: 'success', title: 'Success', kind: 'flow' },
      { name: 'error', title: 'Error', kind: 'flow' },
      { name: 'audioPath', title: 'Audio Path', kind: 'data', valueType: 'string' },
      { name: 'result', title: 'Result', kind: 'data', valueType: 'json' },
      { name: 'errorMessage', title: 'Error Message', kind: 'data', valueType: 'string' },
    ],
    configSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        voice: { type: 'string' },
        lang: { type: 'string' },
        format: { type: 'string' },
      },
      required: ['text'],
    },
    requiredCapabilities: ['tts.synthesize'],
  };

  return {
    definition,
    execute: async (context): Promise<NodeExecutionResult> => {
      const tts = context.capabilities.tts;
      if (!tts) throw new Error('TTS capability is not available to this workflow.');
      const configuredText = typeof context.node.config.text === 'string'
        ? renderTemplate(context.node.config.text, context)
        : '';
      const textValue = context.inputs.text ?? configuredText;
      const text = typeof textValue === 'string' ? textValue : stringify(textValue);
      try {
        const result = await tts.synthesize(text, {
          voice: typeof context.node.config.voice === 'string' ? context.node.config.voice : 'M1',
          lang: typeof context.node.config.lang === 'string' ? context.node.config.lang : 'en',
          format: typeof context.node.config.format === 'string' ? context.node.config.format : 'wav',
        });
        const audioPath = typeof result.path === 'string' ? result.path : undefined;
        return {
          outputs: audioPath ? { audioPath, result } : { result },
          next: ['success'],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.log(`TTS failed: ${message}`);
        return { outputs: { errorMessage: message }, next: ['error'] };
      }
    },
  };
}

function adjustPointsNode(): NodeImplementation {
  const definition: NodeDefinition = {
    type: 'action.adjust-points',
    version: 1,
    pluginId: 'core',
    title: 'Adjust Points',
    category: 'Actions',
    kind: 'action',
    inputs: [
      FLOW_INPUT,
      { name: 'uniqueId', title: 'Viewer', kind: 'data', valueType: 'string' },
      { name: 'delta', title: 'Delta', kind: 'data', valueType: 'number' },
    ],
    outputs: [
      { name: 'success', title: 'Success', kind: 'flow' },
      { name: 'error', title: 'Error', kind: 'flow' },
      { name: 'result', title: 'Result', kind: 'data', valueType: 'json' },
      { name: 'errorMessage', title: 'Error Message', kind: 'data', valueType: 'string' },
    ],
    configSchema: {
      type: 'object',
      properties: {
        uniqueId: { type: 'string' },
        delta: { type: 'number' },
      },
      required: ['delta'],
    },
    requiredCapabilities: ['points.adjust'],
  };

  return {
    definition,
    execute: async (context): Promise<NodeExecutionResult> => {
      const points = context.capabilities.points;
      if (!points) throw new Error('Points capability is not available to this workflow.');
      const configuredId = typeof context.node.config.uniqueId === 'string'
        ? renderTemplate(context.node.config.uniqueId, context)
        : context.event.user?.uniqueId ?? '';
      const uniqueIdValue = context.inputs.uniqueId ?? configuredId;
      const uniqueId = typeof uniqueIdValue === 'string' ? uniqueIdValue : stringify(uniqueIdValue);
      const deltaValue = context.inputs.delta ?? context.node.config.delta;
      const delta = typeof deltaValue === 'number' ? deltaValue : Number(deltaValue);
      if (!uniqueId.trim() || !Number.isFinite(delta)) {
        return { outputs: { errorMessage: 'Viewer id and numeric delta are required.' }, next: ['error'] };
      }
      try {
        const result = await points.adjust(uniqueId, delta);
        return { outputs: { result }, next: ['success'] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.log(`Point adjustment failed: ${message}`);
        return { outputs: { errorMessage: message }, next: ['error'] };
      }
    },
  };
}

const FLOW_INPUT = { name: 'flow', title: 'Flow', kind: 'flow' as const, required: true };

function readContextPath(context: NodeExecutionContext, pathValue: JsonValue | undefined): JsonValue | undefined {
  if (typeof pathValue !== 'string') return undefined;
  const path = pathValue.trim().replace(/^\{\{\s*|\s*\}\}$/g, '');
  if (!path) return undefined;
  const root: JsonObject = {
    event: context.event,
    data: context.event.data,
    user: context.event.user ?? null,
  };
  return readPath(root, path);
}

function renderTemplate(template: string, context: NodeExecutionContext): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();
    const value = path === 'value'
      ? context.inputs.value
      : readContextPath(context, path);
    return value === undefined || value === null ? '' : stringify(value);
  });
}

function renderHeaders(value: JsonValue | undefined, context: NodeExecutionContext): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue === undefined || rawValue === null) continue;
    headers[key] = typeof rawValue === 'string' ? renderTemplate(rawValue, context) : stringify(rawValue);
  }
  return headers;
}

function readPath(root: JsonValue, path: string): JsonValue | undefined {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  let current: JsonValue | undefined = root;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else {
      current = current[part];
    }
  }
  return current;
}

function compare(left: JsonValue | undefined, right: JsonValue | undefined, operator: string): boolean {
  switch (operator) {
    case 'equals':
    case '==':
    case '===':
      return stringify(left) === stringify(right);
    case 'not-equals':
    case '!=':
    case '!==':
      return stringify(left) !== stringify(right);
    case 'greater-than':
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case 'greater-or-equal':
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'less-than':
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case 'less-or-equal':
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'contains':
      return typeof left === 'string' && typeof right === 'string' && left.includes(right);
    case 'starts-with':
      return typeof left === 'string' && typeof right === 'string' && left.startsWith(right);
    case 'truthy':
      return Boolean(left);
    case 'falsy':
      return !left;
    default:
      return false;
  }
}

function stringify(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Automation run was cancelled.'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Automation run was cancelled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function eventTrigger(eventType: string): WorkflowNode {
  return {
    id: `trigger-${eventType.replaceAll('.', '-')}`,
    type: 'trigger.event',
    version: 1,
    position: { x: 80, y: 80 },
    config: { eventType },
  };
}

export function createStarterWorkflow(id = 'starter-gift-log'): {
  schemaVersion: 1;
  id: string;
  name: string;
  enabled: boolean;
  nodes: WorkflowNode[];
  edges: [];
} {
  return {
    schemaVersion: 1,
    id,
    name: 'Gift logger',
    enabled: false,
    nodes: [eventTrigger('tiktok.gift')],
    edges: [],
  };
}
