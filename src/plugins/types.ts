/** JSON values are the only values allowed across the host/plugin APIs. */
export type PluginJsonPrimitive = string | number | boolean | null;
export type PluginJsonValue = PluginJsonPrimitive | PluginJsonObject | PluginJsonValue[];
export interface PluginJsonObject {
  [key: string]: PluginJsonValue | undefined;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface LoggerAPI {
  debug(message: string, metadata?: PluginJsonObject): void;
  info(message: string, metadata?: PluginJsonObject): void;
  warn(message: string, metadata?: PluginJsonObject): void;
  error(message: string, metadata?: PluginJsonObject): void;
}

export interface CommandAPI {
  register<TParams extends PluginJsonValue = PluginJsonValue, TResult extends PluginJsonValue = PluginJsonValue>(
    name: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ): Disposable;
}

export interface EventAPI {
  subscribe<TPayload extends PluginJsonValue = PluginJsonValue>(
    event: string,
    handler: (payload: TPayload) => void | Promise<void>,
  ): Disposable;
  publish<TPayload extends PluginJsonValue = PluginJsonValue>(event: string, payload: TPayload): void;
}

export interface StorageAPI {
  get<TValue extends PluginJsonValue = PluginJsonValue>(key: string): Promise<TValue | undefined>;
  set<TValue extends PluginJsonValue = PluginJsonValue>(key: string, value: TValue): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface UISettingsPanel {
  id: string;
  title: string;
  entry: string;
}

export interface UIAPI {
  registerSettingsPanel(panel: UISettingsPanel): Disposable;
}

export interface I18nAPI {
  readonly locale: string;
  readonly defaultLocale: string;
  readonly catalog: Readonly<Record<string, Record<string, string>>>;
  t(key: string, variables?: Record<string, string | number>): string;
}

export type AudioProviderCapability =
  | 'playback'
  | 'recording'
  | 'devices'
  | 'decode'
  | 'encode'
  | 'mixer'
  | 'stream'
  | 'effects';

export interface AudioPlayOptions {
  volume?: number;
  overlap?: 'allow' | 'restart' | 'drop';
}

export interface AudioProvider {
  id: string;
  name: string;
  capabilities: readonly AudioProviderCapability[];
  priority?: number;
  play(file: string, options?: AudioPlayOptions): PluginJsonObject | Promise<PluginJsonObject>;
  stopAll?(): void | Promise<void>;
}

export type TTSFormat = 'wav' | 'mp3' | 'ogg' | 'flac' | 'opus';

export interface TTSRequest {
  text: string;
  voice?: string;
  model?: string;
  language?: string;
  /** Kept as an alias for providers that use the shorter field name. */
  lang?: string;
  speed?: number;
  format?: TTSFormat;
}

export interface TTSVoice extends PluginJsonObject {
  id: string;
  name?: string;
  language?: string;
}

export interface TTSModel extends PluginJsonObject {
  id: string;
  name?: string;
}

export interface TTSResult extends PluginJsonObject {
  path?: string;
  format?: TTSFormat | string;
}

export interface TTSProvider {
  id: string;
  name: string;
  priority?: number;
  synthesize(request: TTSRequest): TTSResult | Promise<TTSResult>;
  listVoices?(): TTSVoice[] | Promise<TTSVoice[]>;
  getModels?(): TTSModel[] | Promise<TTSModel[]>;
  stop?(): void | Promise<void>;
}

export interface PluginIdentity {
  id: string;
  version: string;
  dataDir: string;
}

export interface PluginContext {
  plugin: PluginIdentity;
  logger: LoggerAPI;
  commands: CommandAPI;
  events: EventAPI;
  storage: StorageAPI;
  ui: UIAPI;
  i18n: I18nAPI;
  /** Present only when the manifest grants an audio permission. */
  audio?: AudioAPI;
  /** Present only when the manifest grants a TTS permission. */
  tts?: TTSAPI;
}

export interface AudioAPI {
  registerProvider(provider: AudioProvider): Disposable;
}

export interface TTSAPI {
  registerProvider(provider: TTSProvider): Disposable;
}

export interface AppPlugin {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export type PluginModule = AppPlugin | { default: AppPlugin };
