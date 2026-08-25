import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ensureAppPaths, getAppPaths } from './app-paths.ts';

let installed = false;
let writeQueue: Promise<void> = Promise.resolve();
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_FILE = 'TikTools.log';
const ROTATED_LOG_FILE = 'TikTools.log.1';

function redact(value: string): string {
  return value
    .replace(/((?:sessionid|sessionid_ss|sid_tt|msToken|ttwid|odin_tt|csrfToken)=)[^;\s]+/gi, '$1<redacted>')
    .replace(/(--token(?:=|\s+))[^\s]+/gi, '$1<redacted>')
    .replace(/(\bAuthorization\s*:\s*Bearer\s+)[^\s,;]+/gi, '$1<redacted>')
    .replace(/(\bBearer\s+)[^\s,;]+/gi, '$1<redacted>')
    .replace(/(\b(?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi, '$1<redacted>')
    .replace(/(["']?(?:authorization|cookie|set-cookie|token|accessToken|refreshToken|apiKey|secret)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,;}\s]+)/gi, '$1<redacted>');
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
    const file = join(paths.logs, LOG_FILE);
    await rotateIfNeeded(file, Buffer.byteLength(line, 'utf8'));
    await appendFile(file, line, 'utf8');
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

  const terminateForFatalError = (label: string, error: unknown): void => {
    writeFatalLine('error', [label, error]);
    originalError(`[${label}]`, error);
    process.exit(1);
  };

  // A normal uncaughtException listener changes Node/Bun's fatal-error
  // semantics. Persist the line synchronously, then terminate explicitly so
  // a partially initialized GUI cannot remain alive after a fatal exception.
  process.on('uncaughtException', (error: unknown) => {
    terminateForFatalError('uncaughtException', error);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    terminateForFatalError('unhandledRejection', reason);
  });
}

async function rotateIfNeeded(file: string, incomingBytes: number): Promise<void> {
  let size = 0;
  try {
    size = (await stat(file)).size;
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }
  if (size === 0 || size + incomingBytes <= MAX_LOG_BYTES) return;

  const rotated = `${file}.1`;
  await rm(rotated, { force: true });
  await rename(file, rotated);
}

function writeFatalLine(level: 'error', values: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${redact(values.map(format).join(' '))}\n`;
  try {
    const paths = ensureAppPaths(getAppPaths());
    mkdirSync(paths.logs, { recursive: true });
    const file = join(paths.logs, LOG_FILE);
    let size = 0;
    try {
      size = statSync(file).size;
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }
    if (size > 0 && size + Buffer.byteLength(line, 'utf8') > MAX_LOG_BYTES) {
      const rotated = join(paths.logs, ROTATED_LOG_FILE);
      rmSync(rotated, { force: true });
      renameSync(file, rotated);
    }
    appendFileSync(file, line, 'utf8');
  } catch {
    // Fatal handling must still terminate if the log directory is unavailable.
  }
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT';
}
