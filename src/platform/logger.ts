import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { ensureAppPaths, getAppPaths } from './app-paths.ts';

let installed = false;
let writeQueue: Promise<void> = Promise.resolve();

function redact(value: string): string {
  return value
    .replace(/((?:sessionid|sessionid_ss|sid_tt|msToken|ttwid|odin_tt|csrfToken)=)[^;\s]+/gi, '$1<redacted>')
    .replace(/(--token\s+)[^\s]+/gi, '$1<redacted>');
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function append(level: 'info' | 'warn' | 'error', values: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${redact(values.map(format).join(' '))}\n`;
  writeQueue = writeQueue.then(async () => {
    const paths = ensureAppPaths(getAppPaths());
    await mkdir(paths.logs, { recursive: true });
    await appendFile(join(paths.logs, 'TikTools.log'), line, 'utf8');
  }).catch(() => undefined);
}

export function logApp(level: 'info' | 'warn' | 'error', ...values: unknown[]): void {
  append(level, values);
}

export function installProcessLogging(): void {
  if (installed) return;
  installed = true;

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.log = (...values: unknown[]) => {
    originalLog(...values);
    append('info', values);
  };
  console.warn = (...values: unknown[]) => {
    originalWarn(...values);
    append('warn', values);
  };
  console.error = (...values: unknown[]) => {
    originalError(...values);
    append('error', values);
  };

  process.on('uncaughtException', (error: unknown) => {
    append('error', ['uncaughtException', error]);
    originalError(error);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    append('error', ['unhandledRejection', reason]);
    originalError(reason);
  });
}
