import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { artifactPath, hostTarget } from './build-targets.ts';

const target = hostTarget();
const executable = artifactPath(target);
if (!existsSync(executable)) {
  throw new Error(`Missing ${executable}. Run bun run build:exe first.`);
}

const root = await mkdtemp(join(tmpdir(), 'TikTools-compiled-smoke-'));
const appHome = join(root, 'appdata');
const workingDirectory = join(root, 'working-directory');
const pluginId = 'dev.tiktools.compiled-smoke';
const pluginDirectory = join(appHome, 'plugins', 'compiled-smoke');
const logPath = join(appHome, 'logs', 'TikTools.log');

await mkdir(pluginDirectory, { recursive: true });
await mkdir(workingDirectory, { recursive: true });

await writeFile(
  join(pluginDirectory, 'plugin.json'),
  JSON.stringify({
    manifestVersion: 1,
    id: pluginId,
    name: 'Compiled worker smoke test',
    version: '1.0.0',
    apiVersion: 1,
    executionMode: 'sandbox',
    entry: 'index.js',
    permissions: { capabilities: [] },
  }),
);
await writeFile(
  join(pluginDirectory, 'index.js'),
  `import { registerNode } from '@tiktools/sdk';
registerNode({
  definition: {
    type: 'compiled.smoke.node',
    version: 1,
    title: 'Compiled smoke node',
    category: 'Tests',
    kind: 'transform',
    inputs: [],
    outputs: [],
    configSchema: {}
  },
  handler: 'return { outputs: { ok: true } };'
});
`,
);

const child = Bun.spawn([executable], {
  cwd: workingDirectory,
  env: { ...process.env, TIKTOOLS_HOME: appHome },
  stdout: 'pipe',
  stderr: 'pipe',
});

let passed = false;
try {
  const deadline = Date.now() + 20_000;
  let loaded = false;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const stderr = await new Response(child.stderr).text();
      throw new Error(
        `Compiled app exited with code ${child.exitCode} before the smoke test completed.\n${stderr}`,
      );
    }

    const log = await readFile(logPath, 'utf8').catch(() => '');
    if (log.includes(`[automation-plugins] loaded ${pluginId}@1.0.0`)) {
      loaded = true;
      break;
    }
    await Bun.sleep(250);
  }

  if (!loaded) throw new Error(`Compiled plugin worker did not load the fixture. See ${logPath}`);
  for (const database of ['tiktok-points.db', 'tiktok-automation.db']) {
    if (!existsSync(join(appHome, 'data', database))) {
      throw new Error(`Compiled app did not initialize ${database}.`);
    }
  }
  if (existsSync(join(workingDirectory, 'data'))) {
    throw new Error('Compiled app wrote data under its working directory.');
  }

  passed = true;
  console.log(`Compiled ${target.artifact} smoke test passed.`);
} finally {
  child.kill();
  await child.exited;
  if (passed) {
    await rm(root, { recursive: true, force: true });
  } else {
    console.warn(`Compiled smoke artifacts retained at ${root}`);
  }
}
