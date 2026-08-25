import type { AutomationEventType } from '../types.ts';
import type { LivePlugin, LivePluginAction } from './types.ts';

/**
 * The gallery. Every entry produces the same `LivePlugin` shape; only the form
 * the editor renders differs. `emit`-backed entries are bound to a host
 * capability by the engine, so the plugin model still has two primitives.
 */
export type LivePluginFormKind = 'fetch' | 'emit' | 'sound' | 'tts' | 'points' | 'code';

export interface LivePluginTemplate {
  id: string;
  tag: 'fetch' | 'emit' | 'code';
  form: LivePluginFormKind;
  /** Monospace line shown in the gallery thumbnail. */
  preview: string;
  title: { en: string; es: string };
  description: { en: string; es: string };
  permission: { en: string; es: string };
  defaultTrigger: AutomationEventType;
  defaultName: { en: string; es: string };
  action: () => LivePluginAction;
}

export const LIVE_PLUGIN_TEMPLATES: LivePluginTemplate[] = [
  {
    id: 'webhook',
    tag: 'fetch',
    form: 'fetch',
    preview: 'POST /webhook',
    title: { en: 'Call a URL', es: 'Llamar a una URL' },
    description: {
      en: 'POST or GET the event data to your server, Discord, or StreamElements.',
      es: 'POST o GET con los datos del evento a tu servidor, Discord o StreamElements.',
    },
    permission: { en: 'network · the domain you type', es: 'network · el dominio que escribas' },
    defaultTrigger: 'tiktok.gift',
    defaultName: { en: 'Gift → webhook', es: 'Regalo → webhook' },
    action: () => ({
      kind: 'fetch',
      method: 'POST',
      url: 'https://',
      headers: { 'content-type': 'application/json' },
      body: [
        '{',
        '  "usuario": "{{ event.user.uniqueId }}",',
        '  "evento": "{{ event.type }}"',
        '}',
      ].join('\n'),
    }),
  },
  {
    id: 'overlay',
    tag: 'emit',
    form: 'emit',
    preview: 'emit overlay.alert',
    title: { en: 'Notify the overlay', es: 'Avisar al overlay' },
    description: {
      en: 'Publish an internal event your scenes and other plugins consume.',
      es: 'Publica un evento interno que consumen tus escenas y otros plugins.',
    },
    permission: { en: 'no permissions · stays in the app', es: 'sin permisos · se queda en la app' },
    defaultTrigger: 'tiktok.follow',
    defaultName: { en: 'Overlay alert', es: 'Aviso en el overlay' },
    action: () => ({
      kind: 'emit',
      type: 'overlay.alert',
      data: {
        text: '{{ event.user.nickname }} te sigue',
      },
    }),
  },
  {
    id: 'sound',
    tag: 'emit',
    form: 'sound',
    preview: 'emit overlay.sound',
    title: { en: 'Play a sound', es: 'Reproducir sonido' },
    description: {
      en: 'Emits overlay.sound with a file from your sounds folder.',
      es: 'Emite overlay.sound con un archivo de tu carpeta de sonidos.',
    },
    permission: { en: 'files · sounds folder', es: 'files · carpeta de sonidos' },
    defaultTrigger: 'tiktok.gift',
    defaultName: { en: 'Gift sound', es: 'Sonido de regalo' },
    action: () => ({
      kind: 'emit',
      type: 'overlay.sound',
      data: { file: 'assets/sounds/alert.wav', volume: '1' },
    }),
  },
  {
    id: 'tts',
    tag: 'emit',
    form: 'tts',
    preview: 'emit tts.speak',
    title: { en: 'Read out loud', es: 'Leer en voz alta' },
    description: {
      en: 'Emits tts.speak with a text template built from the event.',
      es: 'Emite tts.speak con una plantilla de texto del evento.',
    },
    permission: { en: 'capabilities · tts.speak', es: 'capabilities · tts.speak' },
    defaultTrigger: 'tiktok.chat',
    defaultName: { en: 'Read the chat', es: 'Leer el chat' },
    action: () => ({
      kind: 'emit',
      type: 'tts.speak',
      data: {
        text: '{{ event.user.nickname }} dice {{ event.data.comment }}',
        voice: 'M1',
        lang: 'es',
      },
    }),
  },
  {
    id: 'points',
    tag: 'emit',
    form: 'points',
    preview: 'emit points.add',
    title: { en: 'Give points', es: 'Sumar puntos' },
    description: {
      en: 'Adds or subtracts points for the viewer who triggered the event.',
      es: 'Suma o resta puntos al espectador que disparó el evento.',
    },
    permission: { en: 'capabilities · points.write', es: 'capabilities · points.write' },
    defaultTrigger: 'tiktok.share',
    defaultName: { en: 'Points for sharing', es: 'Puntos por compartir' },
    action: () => ({
      kind: 'emit',
      type: 'points.add',
      data: { uniqueId: '{{ event.user.uniqueId }}', delta: '10' },
    }),
  },
  {
    id: 'code',
    tag: 'code',
    form: 'code',
    preview: 'onEvent()',
    title: { en: 'Start from scratch', es: 'Empezar en blanco' },
    description: {
      en: 'JavaScript in napi-vm, with the event, fetch, and emit.',
      es: 'JavaScript en napi-vm, con el evento, fetch y emit.',
    },
    permission: { en: 'permissions you declare', es: 'permisos que declares tú' },
    defaultTrigger: 'tiktok.gift',
    defaultName: { en: 'New script', es: 'Script nuevo' },
    action: () => ({
      kind: 'code',
      source: [
        '// Se ejecuta en napi-vm, aislado del host.',
        '// Devuelve lo que quieres que haga el anfitrión.',
        'log(`${event.user.uniqueId} · ${event.type}`)',
        '',
        'return {',
        '  emit: [{ type: "overlay.rank", data: { nombre: event.user.nickname } }],',
        '  // fetch: { url: "https://ejemplo.com/rank", method: "POST", body: "{}" },',
        '  // emitResponseAs: "overlay.rank.done",',
        '}',
      ].join('\n'),
    }),
  },
];

export function findLivePluginTemplate(id: string): LivePluginTemplate | undefined {
  return LIVE_PLUGIN_TEMPLATES.find((template) => template.id === id);
}

export function createLivePluginFromTemplate(
  template: LivePluginTemplate,
  locale: 'en' | 'es',
  id: string,
): LivePlugin {
  return {
    schemaVersion: 1,
    id,
    name: template.defaultName[locale],
    enabled: false,
    templateId: template.id,
    mode: template.form === 'code' ? 'code' : 'template',
    trigger: template.defaultTrigger,
    cooldownMs: 0,
    cooldownScope: 'user',
    action: template.action(),
  };
}
