import type { AutomationPluginManifest } from './manifest.ts';
import type { ActionTypeDefinition } from '../behavior/types.ts';
import type {
  AutomationEvent,
  JsonObject,
  JsonValue,
  NodeDefinition,
  NodeExecutionResult,
  WorkflowNode,
} from '../types.ts';
import type { LiveAction } from '../behavior/types.ts';

/**
 * The worker protocol deliberately carries only JSON. VM handles, host
 * services, database objects, and native resources never cross this boundary.
 */
export interface SandboxNodeDescriptor {
  definition: Omit<NodeDefinition, 'pluginId'> & { pluginId?: string };
  handler: string;
  async?: boolean;
  /** `isAsync` avoids the napi-vm object-literal parser treating `async` as a keyword. */
  isAsync?: boolean;
}

export interface SandboxActionDescriptor {
  definition: Omit<ActionTypeDefinition, 'source'> & { source?: ActionTypeDefinition['source'] };
  handler: string;
  async?: boolean;
  isAsync?: boolean;
}

export interface SandboxExecutionRequest {
  runId: string;
  workflowId: string;
  node: WorkflowNode;
  event: AutomationEvent;
  inputs: JsonObject;
}

export interface SandboxActionExecutionRequest {
  action: LiveAction;
  event: AutomationEvent;
}

export type PluginWorkerRequest =
  | {
      type: 'request';
      id: string;
      method: 'load';
      manifest: AutomationPluginManifest;
      source: string;
    }
  | {
      type: 'request';
      id: string;
      method: 'execute';
      nodeType: string;
      executionId: string;
      request: SandboxExecutionRequest;
    }
  | {
      type: 'request';
      id: string;
      method: 'executeAction';
      actionType: string;
      executionId: string;
      request: SandboxActionExecutionRequest;
    }
  | {
      type: 'request';
      id: string;
      method: 'shutdown';
    }
  | {
      type: 'capability.response';
      requestId: string;
      result?: JsonValue;
      error?: string;
    };

export type PluginWorkerResponse =
  | {
      type: 'response';
      id: string;
      ok: true;
      result: JsonValue;
    }
  | {
      type: 'response';
      id: string;
      ok: false;
      error: string;
    }
  | {
      type: 'capability.request';
      requestId: string;
      executionId: string;
      name: string;
      params: JsonValue;
    }
  | {
      type: 'log';
      executionId?: string;
      message: string;
      metadata?: JsonObject;
    };

export interface SandboxLoadResult {
  nodes: SandboxNodeDescriptor[];
  actions: SandboxActionDescriptor[];
}

export function isPluginWorkerResponse(value: unknown): value is PluginWorkerResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  if (object.type === 'response') {
    return typeof object.id === 'string'
      && typeof object.ok === 'boolean'
      && (object.ok ? isJsonValue(object.result) : typeof object.error === 'string');
  }
  if (object.type === 'capability.request') {
    return typeof object.requestId === 'string'
      && typeof object.executionId === 'string'
      && typeof object.name === 'string'
      && isJsonValue(object.params);
  }
  if (object.type === 'log') {
    return typeof object.message === 'string'
      && (object.executionId === undefined || typeof object.executionId === 'string')
      && (object.metadata === undefined || isJsonObject(object.metadata));
  }
  return false;
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value) && Object.values(value).every((entry) => entry === undefined || isJsonValue(entry));
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asJsonObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

export function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

export function asNodeExecutionResult(value: unknown): NodeExecutionResult {
  const object = asJsonObject(value, 'Plugin node result');
  const outputsValue = object.outputs;
  const nextValue = object.next;
  const outputs: Record<string, JsonValue> = {};
  if (outputsValue !== undefined) {
    const outputObject = asJsonObject(outputsValue, 'Plugin node result.outputs');
    for (const [key, item] of Object.entries(outputObject)) {
      if (item !== undefined) outputs[key] = item;
    }
  }
  let next: string[] | undefined;
  if (nextValue !== undefined) {
    if (!Array.isArray(nextValue) || nextValue.some((item) => typeof item !== 'string')) {
      throw new Error('Plugin node result.next must be an array of strings.');
    }
    next = nextValue as string[];
  }
  return { outputs, next };
}

export function asActionExecutionResult(value: unknown): { summary: string } {
  const object = asJsonObject(value, 'Plugin action result');
  return { summary: asString(object.summary, 'Plugin action result.summary') };
}
