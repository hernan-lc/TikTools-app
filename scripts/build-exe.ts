import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createAppIconIco } from '../src/app-icon.ts';

const outputDirectory = resolve(process.cwd(), process.env.TIKTOOLS_EXE_OUTDIR ?? 'dist');
const outputFile = resolve(outputDirectory, 'TikTools.exe');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const iconDirectory = await mkdtemp(join(tmpdir(), 'tiktools-icon-'));
const iconPath = join(iconDirectory, 'TikTools.ico');
await writeFile(iconPath, createAppIconIco());

try {
  const result = await Bun.build({
    entrypoints: ['./index.ts'],
    compile: {
      target: 'bun-windows-x64',
      outfile: outputFile,
      windows: {
        hideConsole: true,
        icon: iconPath,
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
    throw new Error('Windows executable build failed.');
  }

  console.log(`Built ${outputFile}`);
} finally {
  await rm(iconDirectory, { recursive: true, force: true });
}
