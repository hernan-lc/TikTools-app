import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

import { createAppIconIco } from '../src/app-icon.ts';
import {
  artifactPath,
  compileTargets,
  hostTarget,
  outputDirectory,
  resolveTargets,
} from './build-targets.ts';

export const hostOutputDirectory = resolve(
  process.cwd(),
  process.env.TIKTOOLS_HOST_OUTDIR ?? 'dist/host',
);

const pluginPackages = [
  ['plugins/miniaudio/src/plugin.ts', 'plugins/miniaudio/dist/plugin.js'],
  ['plugins/sonicboom/src/plugin.ts', 'plugins/sonicboom/dist/plugin.js'],
] as const;

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

async function readAppVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '1.0.0';
  } catch {
    return '1.0.0';
  }
}

/** Compile standalone binaries for the requested targets (default: host). */
export async function buildBinary(rawArgs: readonly string[]): Promise<void> {
  const targets = resolveTargets(rawArgs);
  const version = await readAppVersion();
  const started = performance.now();

  await mkdir(outputDirectory, { recursive: true });
  // Only the artifacts being rebuilt are removed (plus their linked
  // sourcemaps), so `build:host` output in the directory survives.
  for (const target of targets) {
    const outfile = artifactPath(target);
    await rm(outfile, { force: true });
    await rm(`${outfile}.map`, { force: true });
  }

  // Only the Windows PE format carries the icon and version resources.
  const needsIcon = targets.some((target) => target.platform === 'win32');
  const iconDirectory = needsIcon ? await mkdtemp(join(tmpdir(), 'tiktools-icon-')) : null;
  const iconPath = iconDirectory ? join(iconDirectory, 'TikTools.ico') : null;
  if (iconPath) await writeFile(iconPath, createAppIconIco());

  try {
    for (const target of targets) {
      const targetStarted = performance.now();
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
                  version,
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
        throw new Error(`Binary build failed for ${target.target}.`);
      }

      if (target.platform !== 'win32') await chmod(outfile, 0o755);
      console.log(`Built ${outfile} (${formatDuration(performance.now() - targetStarted)})`);
    }
    console.log(
      `Done: ${targets.length} ${targets.length === 1 ? 'binary' : 'binaries'} in ${formatDuration(performance.now() - started)}.`,
    );
  } finally {
    if (iconDirectory) await rm(iconDirectory, { recursive: true, force: true });
  }
}

/** Build the development host bundle (requires Bun on the target machine). */
export async function buildHost(): Promise<void> {
  const started = performance.now();
  await rm(hostOutputDirectory, { recursive: true, force: true });
  await mkdir(hostOutputDirectory, { recursive: true });
  const build = await Bun.build({
    entrypoints: ['index.ts'],
    outdir: hostOutputDirectory,
    target: 'bun',
  });

  if (!build.success) {
    for (const message of build.logs) console.error(message);
    throw new Error('Host build failed.');
  }
  console.log(`Host build written to ${hostOutputDirectory} (${formatDuration(performance.now() - started)})`);
}

/** Build the checked-in AppPlugin entries. */
export async function buildPlugins(): Promise<void> {
  const started = performance.now();
  for (const [entrypoint, outfile] of pluginPackages) {
    const result = await Bun.build({ entrypoints: [entrypoint], outdir: dirname(outfile), target: 'bun' });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error(`Plugin build failed: ${entrypoint}`);
    }
    console.log(`Built ${outfile}`);
  }
  console.log(`Done: ${pluginPackages.length} plugins in ${formatDuration(performance.now() - started)}`);
}

/** Full local build: plugins, then the host bundle, then every supported binary. */
export async function buildAll(): Promise<void> {
  await buildPlugins();
  await buildHost();
  await buildBinary(['all']);
}

function assertSafeToRemove(directory: string): void {
  const cwd = resolve(process.cwd());
  if (directory === cwd || !directory.startsWith(cwd + sep)) {
    throw new Error(`Refusing to clean ${directory}: outside the project directory.`);
  }
}

/** Remove generated build output (`dist/` by default). */
export async function cleanOutputs(): Promise<void> {
  for (const directory of [outputDirectory, hostOutputDirectory]) {
    assertSafeToRemove(directory);
    await rm(directory, { recursive: true, force: true });
    console.log(`Removed ${directory}`);
  }
}

/** Print every compile target, marking the host and unsupported ones. */
export function listTargets(): void {
  const host = hostTarget();
  for (const target of compileTargets) {
    const marks = [
      target.target === host.target ? '(host)' : '',
      target.unsupported ? `(unsupported: ${target.unsupported})` : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`${target.target} -> ${target.artifact}${marks ? ` ${marks}` : ''}`);
  }
}
