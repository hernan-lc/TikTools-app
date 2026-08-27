import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createAppIconIco } from '../src/app-icon.ts';
import { artifactPath, outputDirectory, resolveTargets } from './build-targets.ts';

const targets = resolveTargets(process.argv.slice(2));

// Only the artifacts we are about to rebuild are removed, so `build:host`
// output already in the directory survives.
await mkdir(outputDirectory, { recursive: true });
for (const target of targets) await rm(artifactPath(target), { force: true });

// Only the Windows PE format carries the icon and version resources.
const needsIcon = targets.some((target) => target.platform === 'win32');
const iconDirectory = needsIcon ? await mkdtemp(join(tmpdir(), 'tiktools-icon-')) : null;
const iconPath = iconDirectory ? join(iconDirectory, 'TikTools.ico') : null;
if (iconPath) await writeFile(iconPath, createAppIconIco());

try {
  for (const target of targets) {
    const outfile = artifactPath(target);
    if (target.unsupported) {
      console.warn(`Warning: ${target.target} is not a supported release target (${target.unsupported}).`);
    }
    const result = await Bun.build({
      entrypoints: ['./index.ts'],
      compile: {
        target: target.target,
        outfile,
        ...(target.platform === 'win32'
          ? {
              windows: {
                hideConsole: true,
                icon: iconPath!,
                title: 'TikTools',
                publisher: 'TikTools',
                version: '1.0.0',
                description: 'TikTok LIVE desktop companion',
              },
            }
          : {}),
      },
      bytecode: true,
      minify: true,
      sourcemap: 'linked',
    });

    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error(`Executable build failed for ${target.target}.`);
    }

    console.log(`Built ${outfile}`);
  }
} finally {
  if (iconDirectory) await rm(iconDirectory, { recursive: true, force: true });
}
