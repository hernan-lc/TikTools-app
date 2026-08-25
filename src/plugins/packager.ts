import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { readAppPluginManifest, type AppPluginManifest } from './manifest.ts';

export interface PluginPackageOptions {
  sourceDirectory: string;
  outputFile: string;
  stagingDirectory: string;
  hostApiVersion?: string;
  uiApiVersion?: string;
}

/** Creates a ZIP-compatible `.plugin` archive from a prebuilt plugin folder. */
export async function packagePlugin(options: PluginPackageOptions): Promise<{ manifest: AppPluginManifest; outputFile: string }> {
  const sourceDirectory = await resolveExistingDirectory(options.sourceDirectory);
  const manifest = await readAppPluginManifest(join(sourceDirectory, 'plugin.json'), {
    hostApiVersion: options.hostApiVersion ?? '1.0.0',
    uiApiVersion: options.uiApiVersion ?? '1.0.0',
  });
  const outputFile = resolve(options.outputFile).toLowerCase().endsWith('.plugin')
    ? resolve(options.outputFile)
    : `${resolve(options.outputFile)}.plugin`;
  await mkdir(resolve(options.stagingDirectory), { recursive: true });
  const staging = await mkdtemp(join(resolve(options.stagingDirectory), 'package-'));
  try {
    await copyContents(sourceDirectory, staging);
    const checksums: Record<string, string> = {};
    await collectChecksums(staging, staging, checksums);
    await writeFile(join(staging, 'checksums.json'), JSON.stringify(checksums, null, 2), 'utf8');
    await mkdir(dirname(outputFile), { recursive: true });
    await createZip(staging, outputFile);
    return { manifest, outputFile };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function resolveExistingDirectory(path: string): Promise<string> {
  const directory = resolve(path);
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error(`Plugin source is not a directory: ${path}`);
  return directory;
}

async function copyContents(source: string, destination: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === 'checksums.json' || entry.name === 'src' || entry.name === 'node_modules') continue;
    await cp(join(source, entry.name), join(destination, entry.name), { recursive: true, force: true, errorOnExist: false });
  }
}

async function collectChecksums(root: string, directory: string, output: Record<string, string>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectChecksums(root, path, output);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Plugin source contains unsupported entry: ${entry.name}`);
    const relativePath = path.slice(root.length + 1).replaceAll('\\', '/');
    output[relativePath] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
}

async function createZip(sourceDirectory: string, outputFile: string): Promise<void> {
  await mkdir(dirname(outputFile), { recursive: true });
  const windows = process.platform === 'win32';
  const child = windows
    ? Bun.spawn([
      'powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Compress-Archive -Path '${quotePowerShell(join(sourceDirectory, '*'))}' -DestinationPath '${quotePowerShell(outputFile)}' -Force`,
    ], { stdout: 'ignore', stderr: 'pipe', windowsHide: true })
    : Bun.spawn(['zip', '-qr', outputFile, '.'], { cwd: sourceDirectory, stdout: 'ignore', stderr: 'pipe', windowsHide: true });
  if (await child.exited !== 0) throw new Error('Could not create the .plugin archive.');
}

function quotePowerShell(value: string): string { return value.replaceAll("'", "''"); }
