import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { ensureAppPaths, getAppPaths } from '../platform/app-paths.ts';
import { logApp } from '../platform/logger.ts';

/**
 * Resolve a database path and migrate the old ./data location on first use.
 * Explicit paths are used by tests and tools and must never trigger migration.
 */
export function resolveDatabasePath(fileName: string, explicitPath?: string): string {
  if (explicitPath) return explicitPath;

  const paths = ensureAppPaths(getAppPaths());
  const target = join(paths.data, fileName);
  migrateLegacyDatabase(fileName, target);
  return target;
}

function migrateLegacyDatabase(fileName: string, target: string): void {
  const legacy = resolve(process.cwd(), 'data', fileName);
  if (samePath(legacy, target) || existsSync(target) || !existsSync(legacy)) return;

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(legacy, target);
  for (const suffix of ['-wal', '-shm']) {
    const legacySidecar = `${legacy}${suffix}`;
    if (existsSync(legacySidecar)) copyFileSync(legacySidecar, `${target}${suffix}`);
  }
  logApp('info', `Migrated legacy database ${legacy} to ${target}.`);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left).replace(/[\\/]$/, '');
  const normalizedRight = resolve(right).replace(/[\\/]$/, '');
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
