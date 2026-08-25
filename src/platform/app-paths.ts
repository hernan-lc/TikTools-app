import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface AppPaths {
  root: string;
  data: string;
  plugins: string;
  logs: string;
  temp: string;
}

function configuredPath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? resolve(trimmed) : resolve(fallback);
}

function defaultDataRoot(): string {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local');
  }
  return process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share');
}

export function getAppPaths(): AppPaths {
  const root = configuredPath(process.env.TIKTOOLS_HOME, join(defaultDataRoot(), 'TikTools'));
  return {
    root,
    data: configuredPath(process.env.TIKTOOLS_DATA_DIR, join(root, 'data')),
    plugins: configuredPath(process.env.TIKTOOLS_PLUGINS_DIR, join(root, 'plugins')),
    logs: configuredPath(process.env.TIKTOOLS_LOG_DIR, join(root, 'logs')),
    temp: configuredPath(process.env.TIKTOOLS_TEMP_DIR, join(root, 'temp')),
  };
}

export function ensureAppPaths(paths: AppPaths = getAppPaths()): AppPaths {
  for (const directory of [paths.root, paths.data, paths.plugins, paths.logs, paths.temp]) {
    if (!isAbsolute(directory)) throw new Error(`Application path must be absolute: ${directory}`);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  }
  return paths;
}
