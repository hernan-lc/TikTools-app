import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');
const supportedPlatforms = {
  'windows-x86_64': {
    archiveExtension: '.zip',
    binaryName: 'tiktools-desktop.exe',
  },
  'linux-x86_64': {
    archiveExtension: '.tar.gz',
    binaryName: 'tiktools-desktop',
  },
  'macos-arm64': {
    archiveExtension: '.tar.gz',
    binaryName: 'tiktools-desktop',
  },
  'macos-x86_64': {
    archiveExtension: '.tar.gz',
    binaryName: 'tiktools-desktop',
  },
} as const;

type ReleasePlatform = keyof typeof supportedPlatforms;

function fail(message: string): never {
  throw new Error(`Release packaging failed: ${message}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function run(command: string, args: string[]): string {
  const result = Bun.spawnSync({
    cmd: [command, ...args],
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const output = result.stdout ? new TextDecoder().decode(result.stdout) : '';
  if (!result.success) fail(`${command} ${args.join(' ')} exited with code ${result.exitCode}`);
  return output;
}

async function isFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isFile() ?? false;
}

function isSupportedPlatform(value: string): value is ReleasePlatform {
  return Object.hasOwn(supportedPlatforms, value);
}

const tag = requiredEnvironment('RELEASE_TAG');
if (!/^v[^/]+$/.test(tag)) fail(`RELEASE_TAG must be a Git tag such as v0.1.0, got ${tag}`);
const version = tag.slice(1);
const platformValue = requiredEnvironment('RELEASE_PLATFORM');
if (!isSupportedPlatform(platformValue)) {
  fail(`RELEASE_PLATFORM must be one of ${Object.keys(supportedPlatforms).join(', ')}`);
}
const platform = supportedPlatforms[platformValue];

const webRoot = resolve(repositoryRoot, 'dist', 'web');
const webIndex = join(webRoot, 'index.html');
if (!(await isFile(webIndex))) {
  fail(`frontend output is missing ${webIndex}; run bun run build:web first`);
}

const binaryPath = resolve(
  repositoryRoot,
  process.env.RELEASE_BINARY?.trim() || join('target', 'release', platform.binaryName),
);
if (!(await isFile(binaryPath))) {
  fail(`compiled desktop binary is missing ${binaryPath}`);
}

const releaseDirectory = resolve(repositoryRoot, 'release');
const stagingDirectory = join(releaseDirectory, 'staging');
const bundleName = 'TikTools';
const bundleDirectory = join(stagingDirectory, bundleName);
const archiveName = `TikTools-${version}-${platformValue}${platform.archiveExtension}`;
const archivePath = join(releaseDirectory, archiveName);

await rm(bundleDirectory, { recursive: true, force: true });
await rm(archivePath, { force: true });
await mkdir(bundleDirectory, { recursive: true });

await cp(binaryPath, join(bundleDirectory, platform.binaryName));
await mkdir(join(bundleDirectory, 'plugins'), { recursive: true });
// Keep the portable plugin root visible in the archive even when empty.
// `.gitkeep` is not a plugin directory: the runtime scanner only treats
// subdirectories with a `plugin.json` manifest as plugins, so this file is
// ignored naturally during discovery.
await writeFile(join(bundleDirectory, 'plugins', '.gitkeep'), '');
await cp(webRoot, join(bundleDirectory, 'web'), { recursive: true });
for (const file of ['LICENSE', 'README.md']) {
  const source = resolve(repositoryRoot, file);
  if (!(await isFile(source))) fail(`release documentation is missing ${source}`);
  await cp(source, join(bundleDirectory, file));
}

if (platformValue === 'windows-x86_64') {
  run('tar', ['-a', '-c', '-f', archivePath, '-C', stagingDirectory, bundleName]);
} else {
  run('tar', ['-czf', archivePath, '-C', stagingDirectory, bundleName]);
}

const archiveListing = platformValue === 'windows-x86_64'
  ? run('tar', ['-tf', archivePath])
  : run('tar', ['-tzf', archivePath]);
const listingEntries = archiveListing.split(/\r?\n/).map((entry) => entry.replaceAll('\\', '/'));
const expectedEntries = [
  `${bundleName}/${platform.binaryName}`,
  `${bundleName}/web/index.html`,
  `${bundleName}/LICENSE`,
  `${bundleName}/README.md`,
];
for (const expectedEntry of expectedEntries) {
  if (!listingEntries.some((entry) => entry === expectedEntry)) {
    fail(`archive ${archivePath} does not contain ${expectedEntry}`);
  }
}
const hasPluginsDir = listingEntries.some((entry) =>
  entry === `${bundleName}/plugins/` ||
  entry === `${bundleName}/plugins` ||
  entry === `${bundleName}/plugins/.gitkeep`,
);
if (!hasPluginsDir) {
  fail(`archive ${archivePath} does not contain ${bundleName}/plugins/`);
}

// Verify the archive itself, not only the pre-archive staging directory. This
// catches layout regressions caused by the platform tar/ZIP implementation.
const extractedDirectory = join(stagingDirectory, 'verify-extracted');
await rm(extractedDirectory, { recursive: true, force: true });
await mkdir(extractedDirectory, { recursive: true });
run('tar', platformValue === 'windows-x86_64'
  ? ['-xf', archivePath, '-C', extractedDirectory]
  : ['-xzf', archivePath, '-C', extractedDirectory]);
const extractedBundle = join(extractedDirectory, bundleName);
for (const relative of [
  platform.binaryName,
  'web/index.html',
  'LICENSE',
  'README.md',
]) {
  if (!(await isFile(join(extractedBundle, relative)))) {
    fail(`extracted archive is missing ${bundleName}/${relative}`);
  }
}
const extractedPlugins = await stat(join(extractedBundle, 'plugins')).catch(() => null);
if (!extractedPlugins?.isDirectory()) {
  fail(`extracted archive is missing ${bundleName}/plugins/`);
}

console.log(`Created ${basename(archivePath)}`);
console.log(`Package root: ${bundleDirectory}`);
console.log(`Archive: ${archivePath}`);
