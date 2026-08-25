import type { JsonObject, JsonValue } from '../types.ts';
import type { ActionField, ActionTypeDefinition, I18nText, Localized, PluginDescriptor, TranslationCatalog } from './types.ts';

/**
 * Built-in action types have no dependencies, are always available, and cannot
 * be uninstalled. Everything that needs something from outside the app lives in
 * a plugin instead — and one plugin may expose several action types.
 */
const RAW_BUILTIN_ACTION_TYPES: ActionTypeDefinition[] = [
  {
    id: 'core.fetch',
    title: { default: "Call a URL", i18key: "automation.action.core.fetch.title" },
    description: { default: "POST or GET the event data to your server, Discord, or StreamElements.", i18key: "automation.action.core.fetch.description" },
    tag: 'fetch',
    source: { kind: 'builtin' },
    requiredCapabilities: ['http.request'],
    fields: [
      {
        key: 'method',
        label: { default: "Method", i18key: "automation.action.core.fetch.field.method.label" },
        kind: 'select',
        value: 'POST',
        options: [
          { value: 'GET', label: { default: "GET", i18key: "automation.action.core.fetch.field.method.option.GET" } },
          { value: 'POST', label: { default: "POST", i18key: "automation.action.core.fetch.field.method.option.POST" } },
          { value: 'PUT', label: { default: "PUT", i18key: "automation.action.core.fetch.field.method.option.PUT" } },
          { value: 'DELETE', label: { default: "DELETE", i18key: "automation.action.core.fetch.field.method.option.DELETE" } },
        ],
      },
      {
        key: 'url',
        label: { default: "URL", i18key: "automation.action.core.fetch.field.url.label" },
        kind: 'text',
        value: 'https://',
        placeholder: 'https://hooks.example.com/live',
        template: true,
        hint: { default: "The host cannot be templated: it becomes the allowlist.", i18key: "automation.action.core.fetch.field.url.hint" },
      },
      {
        key: 'headers',
        label: { default: "Headers", i18key: "automation.action.core.fetch.field.headers.label" },
        kind: 'keyvalue',
        value: 'content-type=application/json',
        template: true,
        advanced: true,
      },
      {
        key: 'body',
        label: { default: "Body", i18key: "automation.action.core.fetch.field.body.label" },
        kind: 'textarea',
        value: '{\n  "usuario": "{{ event.user.uniqueId }}",\n  "evento": "{{ event.type }}"\n}',
        template: true,
        // A GET carries no body, so the field would only be noise.
        showIf: { key: 'method', notEquals: ['GET'] },
      },
      { key: 'timeoutMs', label: { default: "Timeout (ms)", i18key: "automation.action.core.fetch.field.timeoutMs.label" }, kind: 'number', value: '5000', advanced: true },
      {
        key: 'emitResponseAs',
        label: { default: "Emit the response as", i18key: "automation.action.core.fetch.field.emitResponseAs.label" },
        kind: 'text',
        value: '',
        placeholder: 'overlay.webhook.done',
        advanced: true,
        hint: { default: "Publishes the response as an internal event so another event can chain off it.", i18key: "automation.action.core.fetch.field.emitResponseAs.hint" },
      },
      {
        key: 'allowPrivateNetwork',
        label: { default: "Allow local network", i18key: "automation.action.core.fetch.field.allowPrivateNetwork.label" },
        kind: 'boolean',
        value: 'false',
        advanced: true,
        hint: { default: "Only needed for servers on your own network (localhost, 192.168.x.x).", i18key: "automation.action.core.fetch.field.allowPrivateNetwork.hint" },
      },
    ],
  },
  {
    id: 'core.emit',
    title: { default: "Emit an internal event", i18key: "automation.action.core.emit.title" },
    description: { default: "Publish an event that overlays and other events consume.", i18key: "automation.action.core.emit.description" },
    tag: 'emit',
    source: { kind: 'builtin' },
    requiredCapabilities: [],
    fields: [
      { key: 'type', label: { default: "Internal event", i18key: "automation.action.core.emit.field.type.label" }, kind: 'text', value: 'overlay.alert' },
      {
        key: 'data',
        label: { default: "Data", i18key: "automation.action.core.emit.field.data.label" },
        kind: 'keyvalue',
        value: 'texto={{ event.user.nickname }}',
        template: true,
      },
    ],
  },
  {
    id: 'core.points',
    title: { default: "Give points", i18key: "automation.action.core.points.title" },
    description: { default: "Add or subtract points for the viewer who triggered the event.", i18key: "automation.action.core.points.description" },
    tag: 'puntos',
    source: { kind: 'builtin' },
    requiredCapabilities: ['points.write'],
    fields: [
      { key: 'uniqueId', label: { default: "Viewer", i18key: "automation.action.core.points.field.uniqueId.label" }, kind: 'text', value: '{{ event.user.uniqueId }}', template: true },
      { key: 'delta', label: { default: "Points", i18key: "automation.action.core.points.field.delta.label" }, kind: 'number', value: '10' },
    ],
  },
  {
    id: 'core.delay',
    title: { default: "Wait", i18key: "automation.action.core.delay.title" },
    description: { default: "Delays the remaining actions of the same event.", i18key: "automation.action.core.delay.description" },
    tag: 'flujo',
    source: { kind: 'builtin' },
    requiredCapabilities: [],
    fields: [{ key: 'ms', label: { default: "Duration (ms)", i18key: "automation.action.core.delay.field.ms.label" }, kind: 'number', value: '1000' }],
  },
  {
    id: 'core.log',
    title: { default: "Write to the log", i18key: "automation.action.core.log.title" },
    description: { default: "Leaves a line in the history for debugging.", i18key: "automation.action.core.log.description" },
    tag: 'flujo',
    source: { kind: 'builtin' },
    requiredCapabilities: [],
    fields: [
      {
        key: 'message',
        label: { default: "Message", i18key: "automation.action.core.log.field.message.label" },
        kind: 'text',
        value: '{{ event.user.uniqueId }} · {{ event.type }}',
        template: true,
      },
    ],
  },
  {
    id: 'core.code',
    title: { default: "Code", i18key: "automation.action.core.code.title" },
    description: { default: "JavaScript in napi-vm returning what the host should do.", i18key: "automation.action.core.code.description" },
    tag: 'napi-vm',
    source: { kind: 'builtin' },
    requiredCapabilities: [],
    fields: [
      {
        key: 'source',
        label: { default: "Script", i18key: "automation.action.core.code.field.source.label" },
        kind: 'code',
        value: [
          '// Se ejecuta en napi-vm, aislado del host.',
          'log(`${event.user.uniqueId} · ${event.type}`)',
          '',
          'return {',
          '  emit: [{ type: "overlay.rank", data: { nombre: event.user.nickname } }],',
          '  // fetch: { url: "https://ejemplo.com/rank", method: "POST", body: "{}" },',
          '  // emitResponseAs: "overlay.rank.done",',
          '}',
        ].join('\n'),
      },
    ],
  },
];

/**
 * Bundled plugins ship with the app but stay plugins: they own a dependency
 * (an optional native module, a child process) and can be uninstalled without
 * touching the built-in actions.
 */
const RAW_PLUGIN_ACTION_TYPES: ActionTypeDefinition[] = [
  {
    id: 'audio.play',
    title: { default: "Play a sound", i18key: "automation.action.audio.play.title" },
    description: { default: "A local file, with volume and overlap policy.", i18key: "automation.action.audio.play.description" },
    tag: 'audio',
    source: { kind: 'plugin', pluginId: 'audio.miniaudio' },
    requiredCapabilities: ['audio.play'],
    fields: [
      { key: 'file', label: { default: "File", i18key: "automation.action.audio.play.field.file.label" }, kind: 'text', value: 'assets/sounds/alert.wav', template: true },
      { key: 'volume', label: { default: "Volume", i18key: "automation.action.audio.play.field.volume.label" }, kind: 'number', value: '1', advanced: true },
      {
        key: 'overlap',
        label: { default: "If already playing", i18key: "automation.action.audio.play.field.overlap.label" },
        kind: 'select',
        value: 'allow',
        advanced: true,
        options: [
          { value: 'allow', label: { default: "Allow overlap", i18key: "automation.action.audio.play.field.overlap.option.allow" } },
          { value: 'restart', label: { default: "Restart", i18key: "automation.action.audio.play.field.overlap.option.restart" } },
          { value: 'drop', label: { default: "Drop", i18key: "automation.action.audio.play.field.overlap.option.drop" } },
        ],
      },
    ],
  },
  {
    id: 'audio.stop',
    title: { default: "Stop sound", i18key: "automation.action.audio.stop.title" },
    description: { default: "Stops everything currently playing.", i18key: "automation.action.audio.stop.description" },
    tag: 'audio',
    source: { kind: 'plugin', pluginId: 'audio.miniaudio' },
    requiredCapabilities: ['audio.play'],
    fields: [],
  },
  {
    id: 'tts.speak',
    title: { default: "Read out loud", i18key: "automation.action.tts.speak.title" },
    description: { default: "Synthesizes the text and plays it.", i18key: "automation.action.tts.speak.description" },
    tag: 'voz',
    source: { kind: 'plugin', pluginId: 'tts.sonicboom' },
    requiredCapabilities: ['tts.synthesize'],
    fields: [
      {
        key: 'text',
        label: { default: "Text", i18key: "automation.action.tts.speak.field.text.label" },
        kind: 'text',
        value: '{{ event.user.nickname }} dice {{ event.data.comment }}',
        template: true,
      },
      { key: 'voice', label: { default: "Voice", i18key: "automation.action.tts.speak.field.voice.label" }, kind: 'text', value: 'M1', advanced: true },
      { key: 'lang', label: { default: "Language", i18key: "automation.action.tts.speak.field.lang.label" }, kind: 'text', value: 'es', advanced: true },
    ],
  },
];

const RAW_PLUGIN_DESCRIPTORS: Array<Omit<PluginDescriptor, 'name'> & { name: string }> = [
  {
    id: 'audio.miniaudio',
    name: 'MiniAudio',
    version: '1.6.3',
    description: { default: "Plays local files without going through the browser.", i18key: "plugin.audio.miniaudio.description" },
    dependency: { default: "miniaudio_node · per-platform plugin", i18key: "plugin.audio.miniaudio.dependency" },
    permissions: ['filesystem.read', 'audio.output'],
    actionTypeIds: ['audio.play', 'audio.stop'],
  },
  {
    id: 'tts.sonicboom',
    name: 'SonicBoom TTS',
    version: '1.0.0',
    description: { default: "Speech synthesis in a local process.", i18key: "plugin.tts.sonicboom.description" },
    dependency: { default: "child process · HTTP on localhost", i18key: "plugin.tts.sonicboom.dependency" },
    permissions: ['tts.output', 'process.spawn', 'network.local', 'filesystem.write'],
    actionTypeIds: ['tts.speak'],
  },
];

/** Bundled translations are sent with the behavior snapshot alongside plugin files. */
export const BUILTIN_TRANSLATION_CATALOG: TranslationCatalog = {
  en: {
    "automation.action.core.fetch.title": "Call a URL",
    "automation.action.core.fetch.description": "POST or GET the event data to your server, Discord, or StreamElements.",
    "automation.action.core.fetch.field.method.label": "Method",
    "automation.action.core.fetch.field.method.option.GET": "GET",
    "automation.action.core.fetch.field.method.option.POST": "POST",
    "automation.action.core.fetch.field.method.option.PUT": "PUT",
    "automation.action.core.fetch.field.method.option.DELETE": "DELETE",
    "automation.action.core.fetch.field.url.label": "URL",
    "automation.action.core.fetch.field.url.hint": "The host cannot be templated: it becomes the allowlist.",
    "automation.action.core.fetch.field.headers.label": "Headers",
    "automation.action.core.fetch.field.body.label": "Body",
    "automation.action.core.fetch.field.timeoutMs.label": "Timeout (ms)",
    "automation.action.core.fetch.field.emitResponseAs.label": "Emit the response as",
    "automation.action.core.fetch.field.emitResponseAs.hint": "Publishes the response as an internal event so another event can chain off it.",
    "automation.action.core.fetch.field.allowPrivateNetwork.label": "Allow local network",
    "automation.action.core.fetch.field.allowPrivateNetwork.hint": "Only needed for servers on your own network (localhost, 192.168.x.x).",
    "automation.action.core.emit.title": "Emit an internal event",
    "automation.action.core.emit.description": "Publish an event that overlays and other events consume.",
    "automation.action.core.emit.field.type.label": "Internal event",
    "automation.action.core.emit.field.data.label": "Data",
    "automation.action.core.points.title": "Give points",
    "automation.action.core.points.description": "Add or subtract points for the viewer who triggered the event.",
    "automation.action.core.points.field.uniqueId.label": "Viewer",
    "automation.action.core.points.field.delta.label": "Points",
    "automation.action.core.delay.title": "Wait",
    "automation.action.core.delay.description": "Delays the remaining actions of the same event.",
    "automation.action.core.delay.field.ms.label": "Duration (ms)",
    "automation.action.core.log.title": "Write to the log",
    "automation.action.core.log.description": "Leaves a line in the history for debugging.",
    "automation.action.core.log.field.message.label": "Message",
    "automation.action.core.code.title": "Code",
    "automation.action.core.code.description": "JavaScript in napi-vm returning what the host should do.",
    "automation.action.core.code.field.source.label": "Script",
    "automation.action.audio.play.title": "Play a sound",
    "automation.action.audio.play.description": "A local file, with volume and overlap policy.",
    "automation.action.audio.play.field.file.label": "File",
    "automation.action.audio.play.field.volume.label": "Volume",
    "automation.action.audio.play.field.overlap.label": "If already playing",
    "automation.action.audio.play.field.overlap.option.allow": "Allow overlap",
    "automation.action.audio.play.field.overlap.option.restart": "Restart",
    "automation.action.audio.play.field.overlap.option.drop": "Drop",
    "automation.action.audio.stop.title": "Stop sound",
    "automation.action.audio.stop.description": "Stops everything currently playing.",
    "automation.action.tts.speak.title": "Read out loud",
    "automation.action.tts.speak.description": "Synthesizes the text and plays it.",
    "automation.action.tts.speak.field.text.label": "Text",
    "automation.action.tts.speak.field.voice.label": "Voice",
    "automation.action.tts.speak.field.lang.label": "Language",
    "plugin.audio.miniaudio.description": "Plays local files without going through the browser.",
    "plugin.audio.miniaudio.dependency": "miniaudio_node · per-platform plugin",
    "plugin.tts.sonicboom.description": "Speech synthesis in a local process.",
    "plugin.tts.sonicboom.dependency": "child process · HTTP on localhost",
    "automation.event.field.event.user.uniqueId.label": "Viewer",
    "automation.event.field.event.user.uniqueId.hint": "The @ of whoever triggers the event.",
    "automation.event.field.event.user.nickname.label": "Display name",
    "automation.event.field.event.user.nickname.hint": "The name TikTok shows, which can change.",
    "automation.event.field.event.data.giftName.label": "Gift",
    "automation.event.field.event.data.giftName.hint": "The gift name exactly as TikTok sends it.",
    "automation.event.field.event.data.diamondCount.label": "Diamonds",
    "automation.event.field.event.data.diamondCount.hint": "What the gift is worth in diamonds.",
    "automation.event.field.event.data.repeatCount.label": "Repeat count",
    "automation.event.field.event.data.repeatCount.hint": "How many times in a row the same gift was sent.",
    "automation.event.field.event.data.repeatEnd.label": "Streak finished",
    "automation.event.field.event.data.repeatEnd.hint": "True only on the last hit of a streak: use it to fire once per streak.",
    "automation.event.field.event.data.comment.label": "Message",
    "automation.event.field.event.data.comment.hint": "The text written in chat.",
    "automation.event.field.event.data.count.label": "Likes at once",
    "automation.event.field.event.data.count.hint": "How many likes this event carries.",
    "automation.event.field.event.data.total.label": "Total likes",
    "automation.event.field.event.data.total.hint": "Likes accumulated in the live.",
    "automation.event.field.event.data.delta.label": "Points added",
    "automation.event.field.event.data.delta.hint": "What went up or down in this operation.",
    "automation.event.field.event.data.totalPoints.label": "Total points",
    "automation.event.field.event.data.totalPoints.hint": "The viewer's balance after the change.",
    "automation.event.field.event.data.level.label": "Level",
    "automation.event.field.event.data.level.hint": "The level reached with those points.",
    "automation.event.field.event.data.reason.label": "Reason",
    "automation.event.field.event.data.reason.hint": "Why the points were given: chat, gift…",
    "automation.event.field.event.data.viewers.label": "Viewers",
    "automation.event.field.event.data.viewers.hint": "How many people are watching right now.",
    "automation.event.field.event.data.emitType.label": "Emitted type",
    "automation.event.field.event.data.emitType.hint": "The name the action or plugin emitted.",
  },
  es: {
    "automation.action.core.fetch.title": "Llamar a una URL",
    "automation.action.core.fetch.description": "POST o GET con los datos del evento a tu servidor, Discord o StreamElements.",
    "automation.action.core.fetch.field.method.label": "Método",
    "automation.action.core.fetch.field.method.option.GET": "GET",
    "automation.action.core.fetch.field.method.option.POST": "POST",
    "automation.action.core.fetch.field.method.option.PUT": "PUT",
    "automation.action.core.fetch.field.method.option.DELETE": "DELETE",
    "automation.action.core.fetch.field.url.label": "URL",
    "automation.action.core.fetch.field.url.hint": "El dominio no puede ser una plantilla: se usa para la lista de permitidos.",
    "automation.action.core.fetch.field.headers.label": "Cabeceras",
    "automation.action.core.fetch.field.body.label": "Cuerpo",
    "automation.action.core.fetch.field.timeoutMs.label": "Tiempo máximo (ms)",
    "automation.action.core.fetch.field.emitResponseAs.label": "Emitir la respuesta como",
    "automation.action.core.fetch.field.emitResponseAs.hint": "Publica la respuesta como evento interno, para encadenar otro evento con ella.",
    "automation.action.core.fetch.field.allowPrivateNetwork.label": "Permitir red local",
    "automation.action.core.fetch.field.allowPrivateNetwork.hint": "Necesario sólo para servidores en tu propia red (localhost, 192.168.x.x).",
    "automation.action.core.emit.title": "Emitir evento interno",
    "automation.action.core.emit.description": "Publica un evento que consumen los overlays y otros eventos.",
    "automation.action.core.emit.field.type.label": "Evento interno",
    "automation.action.core.emit.field.data.label": "Datos",
    "automation.action.core.points.title": "Sumar puntos",
    "automation.action.core.points.description": "Suma o resta puntos al espectador que disparó el evento.",
    "automation.action.core.points.field.uniqueId.label": "Espectador",
    "automation.action.core.points.field.delta.label": "Puntos",
    "automation.action.core.delay.title": "Esperar",
    "automation.action.core.delay.description": "Retrasa las acciones siguientes del mismo evento.",
    "automation.action.core.delay.field.ms.label": "Duración (ms)",
    "automation.action.core.log.title": "Escribir en el registro",
    "automation.action.core.log.description": "Deja una línea en el historial para depurar.",
    "automation.action.core.log.field.message.label": "Mensaje",
    "automation.action.core.code.title": "Código",
    "automation.action.core.code.description": "JavaScript en napi-vm que devuelve lo que debe hacer el anfitrión.",
    "automation.action.core.code.field.source.label": "Script",
    "automation.action.audio.play.title": "Reproducir sonido",
    "automation.action.audio.play.description": "Archivo local, con volumen y política de solapamiento.",
    "automation.action.audio.play.field.file.label": "Archivo",
    "automation.action.audio.play.field.volume.label": "Volumen",
    "automation.action.audio.play.field.overlap.label": "Si ya está sonando",
    "automation.action.audio.play.field.overlap.option.allow": "Permitir solape",
    "automation.action.audio.play.field.overlap.option.restart": "Reiniciar",
    "automation.action.audio.play.field.overlap.option.drop": "Descartar",
    "automation.action.audio.stop.title": "Detener sonido",
    "automation.action.audio.stop.description": "Corta todo lo que esté sonando.",
    "automation.action.tts.speak.title": "Leer en voz alta",
    "automation.action.tts.speak.description": "Sintetiza el texto y lo reproduce.",
    "automation.action.tts.speak.field.text.label": "Texto",
    "automation.action.tts.speak.field.voice.label": "Voz",
    "automation.action.tts.speak.field.lang.label": "Idioma",
    "plugin.audio.miniaudio.description": "Reproduce archivos locales sin pasar por el navegador.",
    "plugin.audio.miniaudio.dependency": "miniaudio_node · plugin por plataforma",
    "plugin.tts.sonicboom.description": "Síntesis de voz en un proceso local.",
    "plugin.tts.sonicboom.dependency": "proceso hijo · HTTP en localhost",
    "automation.event.field.event.user.uniqueId.label": "Usuario",
    "automation.event.field.event.user.uniqueId.hint": "El @ de quien dispara el evento.",
    "automation.event.field.event.user.nickname.label": "Nombre visible",
    "automation.event.field.event.user.nickname.hint": "El nombre que muestra TikTok, que puede cambiar.",
    "automation.event.field.event.data.giftName.label": "Regalo",
    "automation.event.field.event.data.giftName.hint": "El nombre del regalo tal y como lo manda TikTok.",
    "automation.event.field.event.data.diamondCount.label": "Diamantes",
    "automation.event.field.event.data.diamondCount.hint": "Lo que vale el regalo en diamantes.",
    "automation.event.field.event.data.repeatCount.label": "Veces seguidas",
    "automation.event.field.event.data.repeatCount.hint": "Cuántas veces seguidas ha mandado el mismo regalo.",
    "automation.event.field.event.data.repeatEnd.label": "Racha terminada",
    "automation.event.field.event.data.repeatEnd.hint": "Cierto sólo en el último golpe de una racha: úsalo para disparar una vez por racha.",
    "automation.event.field.event.data.comment.label": "Mensaje",
    "automation.event.field.event.data.comment.hint": "El texto escrito en el chat.",
    "automation.event.field.event.data.count.label": "Likes de golpe",
    "automation.event.field.event.data.count.hint": "Cuántos likes trae este evento.",
    "automation.event.field.event.data.total.label": "Likes totales",
    "automation.event.field.event.data.total.hint": "Likes acumulados del directo.",
    "automation.event.field.event.data.delta.label": "Puntos sumados",
    "automation.event.field.event.data.delta.hint": "Lo que ha subido o bajado en esta operación.",
    "automation.event.field.event.data.totalPoints.label": "Puntos totales",
    "automation.event.field.event.data.totalPoints.hint": "El saldo del usuario después de sumar.",
    "automation.event.field.event.data.level.label": "Nivel",
    "automation.event.field.event.data.level.hint": "El nivel alcanzado con esos puntos.",
    "automation.event.field.event.data.reason.label": "Motivo",
    "automation.event.field.event.data.reason.hint": "Por qué se han dado los puntos: chat, gift…",
    "automation.event.field.event.data.viewers.label": "Espectadores",
    "automation.event.field.event.data.viewers.hint": "Cuánta gente está viendo ahora mismo.",
    "automation.event.field.event.data.emitType.label": "Tipo emitido",
    "automation.event.field.event.data.emitType.hint": "El nombre que emitió la acción o el plugin.",
  },
};

export const BUILTIN_ACTION_TYPES = RAW_BUILTIN_ACTION_TYPES.map(normalizeActionType);
export const PLUGIN_ACTION_TYPES = RAW_PLUGIN_ACTION_TYPES.map(normalizeActionType);
export const PLUGIN_DESCRIPTORS = RAW_PLUGIN_DESCRIPTORS.map((plugin) => ({
  ...plugin,
  name: normalizeText({ default: plugin.name, i18key: `plugin.${plugin.id}.name` }, `plugin.${plugin.id}.name`),
  description: normalizeText(plugin.description, `plugin.${plugin.id}.description`),
  dependency: normalizeText(plugin.dependency, `plugin.${plugin.id}.dependency`),
}));

function normalizeActionType(type: ActionTypeDefinition): ActionTypeDefinition {
  return {
    ...type,
    title: normalizeText(type.title, `automation.action.${type.id}.title`),
    description: normalizeText(type.description, `automation.action.${type.id}.description`),
    fields: type.fields?.map((field) => normalizeField(field, `automation.action.${type.id}.field.${field.key}`)),
    configSchema: type.configSchema ? normalizeJsonI18n(type.configSchema, `automation.action.${type.id}.schema`) as JsonObject : undefined,
  };
}

function normalizeField(field: ActionField, key: string): ActionField {
  return {
    ...field,
    label: normalizeText(field.label, `${key}.label`),
    hint: field.hint ? normalizeText(field.hint, `${key}.hint`) : undefined,
    options: field.options?.map((option) => ({
      ...option,
      label: normalizeText(option.label, `${key}.option.${option.value}`),
    })),
  };
}

function normalizeText(value: Localized, key: string): I18nText {
  return value.i18key ? value : { default: value.default, i18key: key };
}

function normalizeJsonI18n(value: JsonValue, key: string): JsonValue {
  if (Array.isArray(value)) return value.map((entry, index) => normalizeJsonI18n(entry, `${key}.${index}`));
  if (!isJsonObject(value)) return value;
  if (typeof value.default === 'string' && typeof value.i18key === 'string') return value;
  const result: JsonObject = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryValue !== undefined) result[entryKey] = normalizeJsonI18n(entryValue, `${key}.${entryKey}`);
  }
  return result;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const ALL_ACTION_TYPES: ActionTypeDefinition[] = [...BUILTIN_ACTION_TYPES, ...PLUGIN_ACTION_TYPES];

export function findActionType(id: string): ActionTypeDefinition | undefined {
  return ALL_ACTION_TYPES.find((type) => type.id === id);
}

export function findPluginDescriptor(id: string): PluginDescriptor | undefined {
  return PLUGIN_DESCRIPTORS.find((plugin) => plugin.id === id);
}

export function actionTypesForPlugin(pluginId: string): ActionTypeDefinition[] {
  return PLUGIN_ACTION_TYPES.filter((type) => type.source.kind === 'plugin' && type.source.pluginId === pluginId);
}

/** Plugins installed on a fresh profile: none. Built-in actions cover the basics. */
export const DEFAULT_INSTALLED_PLUGINS: string[] = [];
