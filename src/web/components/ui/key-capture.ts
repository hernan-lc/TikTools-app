/**
 * Records a shortcut from a WebView keydown: the engine behind the
 * "press keys to fill" button in condition value cells. Key names match the
 * hotkey process plugin (`key_name` in its main.rs) so a recorded combo
 * filters exactly what the plugin emits.
 */

export interface KeyCaptureSource {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface CapturedShortcut {
  key: string;
  modifiers: string;
}

const MODIFIER_NAMES = new Set(['ctrl', 'shift', 'alt', 'meta']);

/** Browser `KeyboardEvent.key` -> plugin key name. Empty string ignores the key. */
export function normalizeKeyName(key: string): string {
  if (!key) return '';
  if (key === ' ') return 'space';
  if (key.length === 1) return key.toLowerCase();
  switch (key) {
    case 'Enter': return 'enter';
    case 'Tab': return 'tab';
    case 'Escape': return 'esc';
    case 'Backspace': return 'backspace';
    case 'Delete': return 'delete';
    case 'Insert': return 'insert';
    case 'Home': return 'home';
    case 'End': return 'end';
    case 'PageUp': return 'pageup';
    case 'PageDown': return 'pagedown';
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'CapsLock': return 'capslock';
    case 'Control': return 'ctrl';
    case 'Shift': return 'shift';
    case 'Alt': return 'alt';
    case 'Meta': return 'meta';
    case 'Dead': return '';
    default: return key.toLowerCase();
  }
}

export function isModifierName(name: string): boolean {
  return MODIFIER_NAMES.has(name);
}

/**
 * Captures one shortcut press. Returns null for bare modifiers (the hotkey
 * plugin never emits those) and ignored keys, so the caller stays armed.
 */
export function normalizeCapturedKey(event: KeyCaptureSource): CapturedShortcut | null {
  const key = normalizeKeyName(event.key);
  if (!key || isModifierName(key)) return null;
  const modifiers = [
    event.ctrlKey && 'ctrl',
    event.shiftKey && 'shift',
    event.altKey && 'alt',
    event.metaKey && 'meta',
  ].filter((entry): entry is string => Boolean(entry));
  return { key, modifiers: modifiers.join('+') };
}
