import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const output = resolve(process.cwd(), process.env.TIKTOOLS_WEB_OUTDIR ?? 'dist/web');
await rm(output, { recursive: true, force: true });
await mkdir(dirname(output), { recursive: true });

const result = await Bun.build({
  entrypoints: ['src/web/index.html'],
  outdir: output,
  target: 'browser',
  splitting: true,
  minify: false,
  sourcemap: 'linked',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error('Frontend asset build failed.');
}

console.log(`Frontend assets written to ${output}`);
