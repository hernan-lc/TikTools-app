import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDirectory = resolve(process.cwd(), process.env.TIKTOOLS_HOST_OUTDIR ?? 'dist/host');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const build = await Bun.build({
  entrypoints: ['index.ts'],
  outdir: outputDirectory,
  target: 'bun',
});

if (!build.success) {
  for (const message of build.logs) console.error(message);
  process.exitCode = 1;
} else {
  console.log(`Host build written to ${outputDirectory}`);
}
