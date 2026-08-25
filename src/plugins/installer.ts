import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, rm, stat, lstat, mkdir, mkdtemp, rename } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import { readAppPluginManifest, isSafeRelativePath, type AppPluginManifest, type ReadPluginManifestOptions } from './manifest.ts';

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILES = 50_000;

export interface PluginInstallOptions extends ReadPluginManifestOptions {
  pluginDirectory: string;
  stagingDirectory: string;
  replaceExisting?: boolean;
  verifySignature?: (rootDirectory: string, manifest: AppPluginManifest) => Promise<boolean> | boolean;
  log?: (message: string) => void;
}

export interface InstalledPluginPackage {
  directory: string;
  manifest: AppPluginManifest;
}

/**
 * Installs a prebuilt `.plugin` archive without running package managers or
 * compiling native code. Extraction always happens in a staging directory and
 * the final directory is swapped in only after validation succeeds.
 */
export class PluginInstaller {
  readonly #options: PluginInstallOptions;

  constructor(options: PluginInstallOptions) {
    this.#options = options;
  }

  async install(archivePath: string): Promise<InstalledPluginPackage> {
    const archive = await realpath(archivePath);
    if (extname(archive).toLowerCase() !== '.plugin') throw new Error('Plugin packages must use the .plugin extension.');
    const archiveInfo = await stat(archive);
    if (!archiveInfo.isFile()) throw new Error('Plugin package is not a file.');
    if (archiveInfo.size > MAX_ARCHIVE_BYTES) throw new Error('Plugin package exceeds the 512 MB limit.');

    await mkdir(this.#options.pluginDirectory, { recursive: true });
    await mkdir(this.#options.stagingDirectory, { recursive: true });
    const staging = await mkdtemp(join(this.#options.stagingDirectory, 'plugin-'));
    try {
      await validateArchiveEntries(archive);
      await extractZip(archive, staging);
      const root = await findPackageRoot(staging);
      await validateExtractedTree(root);
      const manifest = await readAppPluginManifest(join(root, 'plugin.json'), this.#options);
      await verifyChecksums(root, manifest);
      const signaturePresent = await exists(join(root, 'signature.json'));
      if (signaturePresent) {
        if (!this.#options.verifySignature) throw new Error('Plugin includes a signature but no verifier is configured.');
        if (!await this.#options.verifySignature(root, manifest)) throw new Error(`Plugin signature verification failed: ${manifest.id}`);
      }

      const target = resolve(this.#options.pluginDirectory, manifest.id);
      const targetRemainder = relative(resolve(this.#options.pluginDirectory), target);
      if (!targetRemainder || targetRemainder.startsWith('..') || isAbsolute(targetRemainder)) {
        throw new Error('Plugin installation target escaped the plugin directory.');
      }
      if (!this.#options.replaceExisting && await exists(target)) {
        throw new Error(`Plugin is already installed: ${manifest.id}`);
      }

      const backup = `${target}.previous-${Date.now().toString(36)}`;
      let movedExisting = false;
      try {
        if (await exists(target)) {
          await rename(target, backup);
          movedExisting = true;
        }
        await rename(root, target);
      } catch (error) {
        if (movedExisting && await exists(backup) && !await exists(target)) await rename(backup, target);
        throw error;
      }
      if (movedExisting) await rm(backup, { recursive: true, force: true });
      this.#options.log?.(`Installed ${manifest.id}@${manifest.version}.`);
      return { directory: target, manifest };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

async function findPackageRoot(staging: string): Promise<string> {
  if (await exists(join(staging, 'plugin.json'))) return staging;
  const entries = (await readdir(staging, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (entries.length === 1 && await exists(join(staging, entries[0]!.name, 'plugin.json'))) {
    return join(staging, entries[0]!.name);
  }
  throw new Error('Plugin archive must contain plugin.json at its root.');
}

async function validateExtractedTree(root: string): Promise<void> {
  const rootReal = await realpath(root);
  let files = 0;
  let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Plugin archive contains a symbolic link: ${entry.name}`);
      const remainder = relative(rootReal, path);
      if (!remainder || remainder.startsWith('..') || isAbsolute(remainder)) throw new Error('Plugin archive contains a path traversal entry.');
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Plugin archive contains an unsupported entry: ${entry.name}`);
      files += 1;
      if (files > MAX_FILES) throw new Error('Plugin archive contains too many files.');
      bytes += (await lstat(path)).size;
      if (bytes > MAX_EXTRACTED_BYTES) throw new Error('Plugin archive expands beyond the 2 GB limit.');
    }
  };
  await visit(rootReal);
}

async function verifyChecksums(root: string, manifest: AppPluginManifest): Promise<void> {
  const checksumPath = join(root, 'checksums.json');
  if (!await exists(checksumPath)) throw new Error(`Plugin ${manifest.id} is missing checksums.json.`);
  const value = JSON.parse(await readFile(checksumPath, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('checksums.json must be an object.');
  const entries = value as Record<string, unknown>;
  if (Object.keys(entries).length === 0) throw new Error(`Plugin ${manifest.id} has no checksums.`);
  for (const [relativePath, expected] of Object.entries(entries)) {
    if (!isSafeRelativePath(relativePath) || typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) {
      throw new Error(`Invalid checksum entry: ${relativePath}`);
    }
    const path = resolve(root, relativePath);
    const remainder = relative(root, path);
    if (!remainder || remainder.startsWith('..') || isAbsolute(remainder)) throw new Error('Checksum path escaped the plugin directory.');
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Checksum target is not a file: ${relativePath}`);
    const digest = createHash('sha256').update(await readFile(path)).digest('hex');
    if (digest.toLowerCase() !== expected.toLowerCase()) throw new Error(`Checksum mismatch in ${manifest.id}: ${relativePath}`);
  }
  for (const relativePath of await allFiles(root)) {
    if (relativePath === 'checksums.json' || relativePath === 'signature.json') continue;
    if (entries[relativePath] === undefined) throw new Error(`Plugin checksum is missing for ${relativePath}.`);
  }
}

async function allFiles(root: string, directory = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await allFiles(root, path));
    else if (entry.isFile()) result.push(path.slice(root.length + 1).replaceAll('\\', '/'));
  }
  return result;
}

async function extractZip(archive: string, destination: string): Promise<void> {
  const windows = process.platform === 'win32';
  const command = windows ? 'powershell.exe' : 'unzip';
  const args = windows
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${powershellQuote(archive)}' -DestinationPath '${powershellQuote(destination)}' -Force`]
    : ['-q', archive, '-d', destination];
  let child = Bun.spawn([command, ...args], { stdout: 'ignore', stderr: 'pipe', windowsHide: true });
  let code = await child.exited;
  if (code !== 0 && !windows) {
    // Some minimal Linux images ship tar but not unzip. BSD tar and bsdtar
    // both understand ZIP archives and preserve the same staging guarantees.
    child = Bun.spawn(['tar', '-xf', archive, '-C', destination], { stdout: 'ignore', stderr: 'pipe', windowsHide: true });
    code = await child.exited;
  }
  if (code !== 0) throw new Error('Could not extract the .plugin archive.');
}

async function validateArchiveEntries(archive: string): Promise<void> {
  const windows = process.platform === 'win32';
  const primary = windows
    ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[System.IO.Compression.ZipFile]::OpenRead('${powershellQuote(archive)}'); try { $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }`]
    : ['unzip', '-Z1', archive];
  let child = Bun.spawn(primary, { stdout: 'pipe', stderr: 'ignore', windowsHide: true });
  let output = await readChildOutput(child);
  if (child.exitCode !== 0) {
    child = Bun.spawn(['tar', '-tf', archive], { stdout: 'pipe', stderr: 'ignore', windowsHide: true });
    output = await readChildOutput(child);
  }
  if (child.exitCode !== 0) throw new Error('Could not inspect the .plugin archive.');
  const entries = output.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0 || entries.length > MAX_FILES) throw new Error('Plugin archive contains an invalid number of entries.');
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!normalized || !isSafeRelativePath(normalized)) throw new Error(`Plugin archive contains an unsafe path: ${entry}`);
  }
}

async function readChildOutput(child: Bun.Subprocess): Promise<string> {
  const stdout = child.stdout;
  const output = stdout && typeof stdout !== 'number' ? await new Response(stdout).text() : '';
  await child.exited;
  return output;
}

function powershellQuote(value: string): string {
  return value.replaceAll("'", "''");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
}
