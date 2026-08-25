import { dirname } from 'node:path';

const packages = [
  ['plugins/miniaudio/src/plugin.ts', 'plugins/miniaudio/dist/plugin.js'],
  ['plugins/sonicboom/src/plugin.ts', 'plugins/sonicboom/dist/plugin.js'],
] as const;

for (const [entrypoint, outfile] of packages) {
  const result = await Bun.build({ entrypoints: [entrypoint], outdir: dirname(outfile), target: 'bun' });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Plugin build failed: ${entrypoint}`);
  }
  console.log(`Built ${outfile}`);
}
