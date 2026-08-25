import { join } from 'node:path';

import { PluginInstaller } from '../src/plugins/installer.ts';
import { ensureAppPaths } from '../src/platform/app-paths.ts';

const archive = process.argv[2];
if (!archive) throw new Error('Usage: bun run scripts/install-plugin.ts <plugin.plugin> [--replace]');
const paths = ensureAppPaths();
const result = await new PluginInstaller({
  pluginDirectory: paths.plugins,
  stagingDirectory: join(paths.temp, 'plugin-install'),
  replaceExisting: process.argv.includes('--replace'),
  log: console.log,
}).install(archive);
console.log(`Installed ${result.manifest.id}@${result.manifest.version} in ${result.directory}`);
