import type { JsonObject, JsonValue } from './types.ts';

export type HttpResponseType = 'auto' | 'json' | 'text' | 'bytes';
export type HttpRedirectMode = 'error' | 'follow';

export interface HttpRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  responseType?: HttpResponseType;
  redirect?: HttpRedirectMode;
  maxRedirects?: number;
  allowedHosts?: string[];
  allowedUrlPatterns?: string[];
  allowPrivateNetwork?: boolean;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  url: string;
  headers: JsonObject;
  body: JsonValue;
}

export interface HttpCapability {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}

export interface AudioCapability {
  playFile(path: string, options?: { volume?: number; overlap?: 'allow' | 'restart' | 'drop' }): Promise<JsonObject>;
}

export interface TtsVoiceOption {
  id: string;
  name?: string;
}

export interface TtsCapability {
  synthesize(text: string, options?: JsonObject): Promise<JsonObject>;
  listVoices?(): Promise<TtsVoiceOption[]>;
}

export interface PointsCapability {
  adjust(uniqueId: string, delta: number): Promise<JsonObject> | JsonObject;
}

export interface ScriptEnvironment {
  event: JsonValue;
  inputs: JsonObject;
}

export interface ScriptCapability {
  evaluate(
    source: string,
    environment: ScriptEnvironment,
    options?: { scopeId?: string; loopLimit?: number; log?: (message: string) => void },
  ): JsonValue;
  clearScope?(scopeId: string): void;
}

export interface AutomationCapabilities {
  http?: HttpCapability;
  audio?: AudioCapability;
  tts?: TtsCapability;
  points?: PointsCapability;
  vm?: ScriptCapability;
}
