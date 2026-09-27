import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');

function fail(message: string): never {
  console.error(`Version check failed: ${message}`);
  process.exit(1);
}

if (process.argv.length > 2) {
  fail('this check takes no arguments; it only compares Cargo.toml with package.json');
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

console.log(`Version check passed: ${cargoVersion}`);
