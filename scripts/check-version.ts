import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');

function fail(message: string): never {
  console.error(`Version check failed: ${message}`);
  process.exit(1);
}

const cargoToml = await readFile(resolve(repositoryRoot, 'Cargo.toml'), 'utf8');
const workspacePackage = cargoToml.match(
  /\[workspace\.package\]([\s\S]*?)(?=\n\s*\[[^\]]+\]|\s*$)/,
)?.[1];
const cargoVersion = workspacePackage?.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m)?.[1];
if (!cargoVersion) fail('Cargo.toml has no [workspace.package].version');

const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
  version?: unknown;
};
if (packageJson.version !== cargoVersion) {
  fail(`package.json version ${String(packageJson.version)} does not match Cargo ${cargoVersion}`);
}

const [tag] = process.argv.slice(2);
if (process.argv.length > 3) fail('expected at most one Git tag argument');
if (tag !== undefined && tag !== `v${cargoVersion}`) {
  fail(`Git tag ${tag} does not match the canonical version v${cargoVersion}`);
}

console.log(`Version check passed: ${cargoVersion}${tag ? ` (${tag})` : ''}`);
