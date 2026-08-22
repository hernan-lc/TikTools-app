import type { Locale } from './i18n.ts';

export type Theme = 'dark' | 'light';

const LOCALE_KEY = 'tiktok-live-locale';
const THEME_KEY = 'tiktok-live-theme';
const USERNAME_KEY = 'tiktok-live-username';
const RECENT_KEY = 'tiktok-live-recents';

function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are optional when the WebView storage is unavailable.
  }
}

export function getInitialLocale(): Locale {
  const stored = readPreference(LOCALE_KEY);
  if (stored === 'en' || stored === 'es') return stored;

  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function getInitialTheme(): Theme {
  const stored = readPreference(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;

  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function saveLocale(locale: Locale): void {
  writePreference(LOCALE_KEY, locale);
}

export function saveTheme(theme: Theme): void {
  writePreference(THEME_KEY, theme);
}

export function getSavedUsername(): string {
  return readPreference(USERNAME_KEY)?.trim().replace(/^@/, '') ?? '';
}

export function saveUsername(username: string): void {
  const clean = username.trim().replace(/^@/, '');
  writePreference(USERNAME_KEY, clean);
  if (clean) {
    addRecentUsername(clean);
  }
}

export function getRecentUsernames(): string[] {
  const stored = readPreference(RECENT_KEY);
  if (!stored) return [];
  try {
    const list = JSON.parse(stored);
    return Array.isArray(list) ? list.filter((u) => typeof u === 'string' && u.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export function addRecentUsername(username: string): string[] {
  const clean = username.trim().replace(/^@/, '');
  if (!clean) return getRecentUsernames();
  const current = getRecentUsernames().filter((u) => u.toLowerCase() !== clean.toLowerCase());
  const updated = [clean, ...current].slice(0, 5);
  writePreference(RECENT_KEY, JSON.stringify(updated));
  return updated;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
