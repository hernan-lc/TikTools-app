import { resolve } from 'node:path';

import { packagePlugin } from '../src/plugins/packager.ts';

const pluginDirectory = process.argv[2];
if (!pluginDirectory) throw new Error('Usage: bun run scripts/package-plugin.ts <plugin-directory> [output.plugin]');
const outputFile = process.argv[3] ?? resolve(`${pluginDirectory.replace(/[\\/]$/, '')}.plugin`);
const result = await packagePlugin({
  sourceDirectory: pluginDirectory,
  outputFile,
  stagingDirectory: resolve('.plugin-staging'),
});
console.log(`Packaged ${result.manifest.id}@${result.manifest.version} -> ${result.outputFile}`);
