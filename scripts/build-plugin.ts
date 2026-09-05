import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');
const examplesRoot = join(repositoryRoot, 'examples');
const defaultOutDirectory = join(repositoryRoot, 'dist', 'plugins');

type ExampleManifest = {
  id?: unknown;
  entry?: unknown;
  runtime?: unknown;
  [key: string]: unknown;
};

function fail(message: string): never {
  throw new Error(`Plugin packaging failed: ${message}`);
}

function runInherit(command: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: [command, ...args],
    cwd: repositoryRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (!result.success) fail(`${command} ${args.join(' ')} exited with code ${result.exitCode}`);
}

function requiredString(value: unknown, field: string, file: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${file} has no valid ${field}`);
  }
  return value as string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function printHelp(): void {
  console.log(`Build distributable .plugin archives from examples/.

Usage:
  bun run build:plugin -- --plugin <directory-or-id>
  bun run build:plugin -- --all
  bun run build:plugins

Options:
  --plugin <name>   Example directory or manifest id (repeatable)
  --all             Build every example with a plugin.json + Cargo.toml
  --out <dir>       Output directory (default: dist/plugins)
  --debug           Use the debug cargo profile (default: release)
  --help            Show this message

Output:
  <out>/<plugin-id>.plugin (a ZIP archive; install via Plugins > Install .plugin…)`);
}

const rawArgs = process.argv.slice(2);
const selected: string[] = [];
let buildAll = false;
let outDirectory = process.env.PLUGIN_OUT_DIR?.trim() || defaultOutDirectory;
let profile: 'release' | 'debug' = 'release';

for (let index = 0; index < rawArgs.length; index += 1) {
  const argument = rawArgs[index];
  if (argument === '--help' || argument === '-h') {
    printHelp();
    process.exit(0);
  } else if (argument === '--all') {
    buildAll = true;
  } else if (argument === '--debug') {
    profile = 'debug';
  } else if (argument === '--plugin' || argument === '--example') {
    const value = rawArgs[index + 1];
    if (!value) fail(`${argument} requires a value`);
    selected.push(value);
    index += 1;
  } else if (argument.startsWith('--plugin=')) {
    selected.push(argument.slice('--plugin='.length));
  } else if (argument.startsWith('--out=')) {
    outDirectory = argument.slice('--out='.length);
  } else if (argument === '--out' || argument === '--outDir') {
    const value = rawArgs[index + 1];
    if (!value) fail(`${argument} requires a value`);
    outDirectory = value;
    index += 1;
  } else if (!argument.startsWith('--')) {
    selected.push(argument);
  } else {
    fail(`unknown argument: ${argument} (see --help)`);
  }
}

if (!buildAll && selected.length === 0) {
  printHelp();
  fail('expected --all or --plugin <name>');
}
if (!outDirectory.trim()) fail('output directory must not be empty');
outDirectory = resolve(repositoryRoot, outDirectory);

type DiscoveredExample = { directory: string; manifestPath: string; manifest: ExampleManifest };

const discovered: DiscoveredExample[] = [];
for (const entry of await readdir(examplesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = join(examplesRoot, entry.name);
  const manifestPath = join(directory, 'plugin.json');
  if (!(await exists(manifestPath)) || !(await exists(join(directory, 'Cargo.toml')))) continue;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ExampleManifest;
  discovered.push({ directory, manifestPath, manifest });
}

const targets = buildAll
  ? discovered
  : selected.map((selector) => {
      const found = discovered.find(
        ({ directory, manifest }) =>
          basename(directory) === selector || manifest.id === selector,
      );
      if (!found) {
        const known = discovered
          .map(({ directory, manifest }) => `${basename(directory)} (${String(manifest.id)})`)
          .join(', ');
        fail(`unknown plugin ${selector}; known: ${known || 'none'}`);
      }
      return found;
    });

if (targets.length === 0) fail('no plugins found under examples/');

await mkdir(outDirectory, { recursive: true });

const built: string[] = [];
for (const { directory, manifestPath, manifest } of targets) {
  const id = requiredString(manifest.id, 'id', manifestPath);
  const sourceEntry = requiredString(manifest.entry, 'entry', manifestPath).replaceAll('\\', '/');
  requiredString(manifest.runtime, 'runtime', manifestPath);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
    fail(`${manifestPath} has an unsafe plugin id: ${id}`);
  }

  console.log(`Building plugin ${id} (${profile})...`);
  runInherit('cargo', [
    'build',
    ...(profile === 'release' ? ['--release'] : []),
    '--manifest-path',
    join(directory, 'Cargo.toml'),
  ]);

  const builtEntry =
    process.platform === 'win32' && !sourceEntry.toLowerCase().endsWith('.exe')
      ? `${sourceEntry}.exe`
      : sourceEntry;
  const builtEntryPath = join(directory, 'target', profile, builtEntry);
  if (!(await exists(builtEntryPath))) {
    fail(`cargo built ${id}, but its declared entry was not found at ${builtEntryPath}`);
  }

  const archivePath = join(outDirectory, `${id}.plugin`);
  runInherit('cargo', [
    'run',
    '-p',
    'tiktools-plugin-sdk',
    '--features',
    'packager',
    '--bin',
    'tiktools-plugin-pack',
    '--',
    '--manifest',
    manifestPath,
    '--entry',
    builtEntryPath,
    '--output',
    archivePath,
  ]);

  console.log(`Created ${basename(archivePath)}`);
  built.push(archivePath);
}

console.log(`Built ${built.length} plugin${built.length === 1 ? '' : 's'} in ${outDirectory}`);
