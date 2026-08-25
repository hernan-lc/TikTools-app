import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDirectory = resolve(process.cwd(), process.env.TIKTOOLS_EXE_OUTDIR ?? 'dist');
const outputFile = resolve(outputDirectory, 'TikTools.exe');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const result = await Bun.build({
  entrypoints: ['./index.ts'],
  compile: {
    target: 'bun-windows-x64',
    outfile: outputFile,
    windows: {
      hideConsole: true,
      title: 'TikTools',
      publisher: 'TikTools',
      version: '1.0.0',
      description: 'TikTok LIVE desktop companion',
    },
  },
  bytecode: true,
  minify: true,
  sourcemap: 'linked',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`Built ${outputFile}`);
