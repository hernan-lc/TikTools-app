import { copyFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const outputDirectory = resolve(process.cwd(), process.env.TIKTOOLS_HOST_OUTDIR ?? 'dist');
const workerSource = resolve(process.cwd(), 'src/automation/plugins/plugin-worker.cjs');

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
  // The child worker is intentionally a separate CommonJS file because the
  // default host launcher uses Node to keep the worker independent of Bun's
  // parent runtime. Bundlers do not copy non-imported files automatically.
  await copyFile(workerSource, join(outputDirectory, 'plugin-worker.cjs'));
  console.log(`Host build written to ${outputDirectory}`);
}
