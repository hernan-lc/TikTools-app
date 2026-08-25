import type { ActionTypeDefinition, PluginDescriptor } from './types.ts';

/**
 * Built-in action types have no dependencies, are always available, and cannot
 * be uninstalled. Everything that needs something from outside the app lives in
 * a plugin instead — and one plugin may expose several action types.
 */
export const BUILTIN_ACTION_TYPES: ActionTypeDefinition[] = [
  {
    id: 'core.fetch',
    title: { es: 'Llamar a una URL', en: 'Call a URL' },
    description: {
      es: 'POST o GET con los datos del evento a tu servidor, Discord o StreamElements.',
      en: 'POST or GET the event data to your server, Discord, or StreamElements.',
    },
    tag: 'fetch',
    source: { kind: 'builtin' },
    requiredCapabilities: ['http.request'],
    fields: [
      {
        key: 'method',
        label: { es: 'Método', en: 'Method' },
        kind: 'select',
        value: 'POST',
        options: [
          { value: 'GET', label: { es: 'GET', en: 'GET' } },
          { value: 'POST', label: { es: 'POST', en: 'POST' } },
          { value: 'PUT', label: { es: 'PUT', en: 'PUT' } },
          { value: 'DELETE', label: { es: 'DELETE', en: 'DELETE' } },
        ],
      },
      {
        key: 'url',
        label: { es: 'URL', en: 'URL' },
        kind: 'text',
        value: 'https://',
        placeholder: 'https://hooks.example.com/live',
        template: true,
        hint: {
          es: 'El dominio no puede ser una plantilla: se usa para la lista de permitidos.',
          en: 'The host cannot be templated: it becomes the allowlist.',
        },
      },
      {
        key: 'headers',
        label: { es: 'Cabeceras', en: 'Headers' },
        kind: 'keyvalue',
        value: 'content-type=application/json',
        template: true,
        advanced: true,
      },
      {
        key: 'body',
        label: { es: 'Cuerpo', en: 'Body' },
        kind: 'textarea',
        value: '{\n  "usuario": "{{ event.user.uniqueId }}",\n  "evento": "{{ event.type }}"\n}',
        template: true,
        // A GET carries no body, so the field would only be noise.
        showIf: { key: 'method', notEquals: ['GET'] },
      },
      { key: 'timeoutMs', label: { es: 'Tiempo máximo (ms)', en: 'Timeout (ms)' }, kind: 'number', value: '5000', advanced: true },
      {
        key: 'emitResponseAs',
        label: { es: 'Emitir la respuesta como', en: 'Emit the response as' },
        kind: 'text',
        value: '',
        placeholder: 'overlay.webhook.done',
        advanced: true,
        hint: {
          es: 'Publica la respuesta como evento interno, para encadenar otro evento con ella.',
          en: 'Publishes the response as an internal event so another event can chain off it.',
        },
      },
      {
        key: 'allowPrivateNetwork',
        label: { es: 'Permitir red local', en: 'Allow local network' },
        kind: 'boolean',
        value: 'false',
        advanced: true,
        hint: {
          es: 'Necesario sólo para servidores en tu propia red (localhost, 192.168.x.x).',
          en: 'Only needed for servers on your own network (localhost, 192.168.x.x).',
        },
      },
    ],
  },
  {
    id: 'core.emit',
    title: { es: 'Emitir evento interno', en: 'Emit an internal event' },
    description: {
      es: 'Publica un evento que consumen los overlays y otros eventos.',
      en: 'Publish an event that overlays and other events consume.',
    },
    tag: 'emit',
    source: { kind: 'builtin' },
    requiredCapabilities: [],
    fields: [
      { key: 'type', label: { es: 'Evento interno', en: 'Internal event' }, kind: 'text', value: 'overlay.alert' },
      {
        key: 'data',
        label: { es: 'Datos', en: 'Data' },
        kind: 'keyvalue',
        value: 'texto={{ event.user.nickname }}',
        template: true,
      },
    ],
  },
  {
    id: 'core.points',
    title: { es: 'Sumar puntos', en: 'Give points' },
    description: {
      es: 'Suma o resta puntos al espectador que disparó el evento.',
      en: 'Add or subtract points for the viewer who triggered the event.',
    },
    tag: 'puntos',
    source: { kind: 'builtin' },
    requiredCapabilities: ['points.write'],
    fields: [
      { key: 'uniqueId', label: { es: 'Espectador', en: 'Viewer' }, kind: 'text', value: '{{ event.user.uniqueId }}', template: true },
      { key: 'delta', label: { es: 'Puntos', en: 'Points' }, kind: 'number', value: '10' },
    ],
  },
  {
    id: 'core.delay',
    title: { es: 'Esperar', en: 'Wait' },
    description: {
      es: 'Retrasa las acciones siguientes del mismo evento.',
      en: 'Delays the remaining actions of the same event.',
    },
    tag: 'flujo',
    source: { kind: 'builtin' },
    requiredCapabilities: [],
    fields: [{ key: 'ms', label: { es: 'Duración (ms)', en: 'Duration (ms)' }, kind: 'number', value: '1000' }],
  },
  {
    id: 'core.log',
    title: { es: 'Escribir en el registro', en: 'Write to the log' },
    description: {
      es: 'Deja una línea en el historial para depurar.',
      en: 'Leaves a line in the history for debugging.',
    },
    tag: 'flujo',
    source: { kind: 'builtin' },
    requiredCapabilities: [],
    fields: [
      {
        key: 'message',
        label: { es: 'Mensaje', en: 'Message' },
        kind: 'text',
        value: '{{ event.user.uniqueId }} · {{ event.type }}',
        template: true,
      },
    ],
  },
  {
    id: 'core.code',
    title: { es: 'Código', en: 'Code' },
    description: {
      es: 'JavaScript en napi-vm que devuelve lo que debe hacer el anfitrión.',
      en: 'JavaScript in napi-vm returning what the host should do.',
    },
    tag: 'napi-vm',
    source: { kind: 'builtin' },
    requiredCapabilities: [],
    fields: [
      {
        key: 'source',
        label: { es: 'Script', en: 'Script' },
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
export const PLUGIN_ACTION_TYPES: ActionTypeDefinition[] = [
  {
    id: 'audio.play',
    title: { es: 'Reproducir sonido', en: 'Play a sound' },
    description: {
      es: 'Archivo local, con volumen y política de solapamiento.',
      en: 'A local file, with volume and overlap policy.',
    },
    tag: 'audio',
    source: { kind: 'plugin', pluginId: 'audio-native' },
    requiredCapabilities: ['audio.play'],
    fields: [
      { key: 'file', label: { es: 'Archivo', en: 'File' }, kind: 'text', value: 'assets/sounds/alert.wav', template: true },
      { key: 'volume', label: { es: 'Volumen', en: 'Volume' }, kind: 'number', value: '1', advanced: true },
      {
        key: 'overlap',
        label: { es: 'Si ya está sonando', en: 'If already playing' },
        kind: 'select',
        value: 'allow',
        advanced: true,
        options: [
          { value: 'allow', label: { es: 'Permitir solape', en: 'Allow overlap' } },
          { value: 'restart', label: { es: 'Reiniciar', en: 'Restart' } },
          { value: 'drop', label: { es: 'Descartar', en: 'Drop' } },
        ],
      },
    ],
  },
  {
    id: 'audio.stop',
    title: { es: 'Detener sonido', en: 'Stop sound' },
    description: { es: 'Corta todo lo que esté sonando.', en: 'Stops everything currently playing.' },
    tag: 'audio',
    source: { kind: 'plugin', pluginId: 'audio-native' },
    requiredCapabilities: ['audio.play'],
    fields: [],
  },
  {
    id: 'tts.speak',
    title: { es: 'Leer en voz alta', en: 'Read out loud' },
    description: {
      es: 'Sintetiza el texto y lo reproduce.',
      en: 'Synthesizes the text and plays it.',
    },
    tag: 'voz',
    source: { kind: 'plugin', pluginId: 'sonicboom-tts' },
    requiredCapabilities: ['tts.synthesize'],
    fields: [
      {
        key: 'text',
        label: { es: 'Texto', en: 'Text' },
        kind: 'text',
        value: '{{ event.user.nickname }} dice {{ event.data.comment }}',
        template: true,
      },
      { key: 'voice', label: { es: 'Voz', en: 'Voice' }, kind: 'text', value: 'M1', advanced: true },
      { key: 'lang', label: { es: 'Idioma', en: 'Language' }, kind: 'text', value: 'es', advanced: true },
    ],
  },
];

export const PLUGIN_DESCRIPTORS: PluginDescriptor[] = [
  {
    id: 'audio-native',
    name: 'Audio nativo',
    version: '1.6.0',
    description: {
      es: 'Reproduce archivos locales sin pasar por el navegador.',
      en: 'Plays local files without going through the browser.',
    },
    dependency: { es: 'miniaudio_node · binario por plataforma', en: 'miniaudio_node · per-platform binary' },
    permissions: ['files', 'audio.play'],
    actionTypeIds: ['audio.play', 'audio.stop'],
  },
  {
    id: 'sonicboom-tts',
    name: 'SonicBoom TTS',
    version: '0.4.2',
    description: {
      es: 'Síntesis de voz en un proceso local.',
      en: 'Speech synthesis in a local process.',
    },
    dependency: { es: 'proceso hijo · HTTP en localhost', en: 'child process · HTTP on localhost' },
    permissions: ['tts.synthesize', 'local'],
    actionTypeIds: ['tts.speak'],
  },
];

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
