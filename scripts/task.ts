import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const bun = process.execPath;
let child: ReturnType<typeof Bun.spawn> | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { child?.kill(signal); process.exitCode = signal === 'SIGINT' ? 130 : 143; });
}
async function run(...cmd: string[]): Promise<void> {
  console.log(`\n> ${cmd.join(' ')}`);
  child = Bun.spawn({ cmd, cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: process.env });
  const code = await child.exited;
  child = undefined;
  if (code !== 0 || process.exitCode) process.exit(process.exitCode || code || 1);
}
const script = (name: string, ...args: string[]) => run(bun, `scripts/${name}`, ...args);
const tool = (name: string, ...args: string[]) => run(bun, 'x', '--no-install', name, ...args);
const cargo = (...args: string[]) => run(bun, 'scripts/cargo-with-linker.mjs', ...args);
async function widgets(): Promise<void> {
  const dirs = await readdir(join(root, 'src/widgets'), { withFileTypes: true });
  const configs: string[] = [];
  for (const dir of dirs) if (dir.isDirectory() && await Bun.file(join(root, 'src/widgets', dir.name, 'vite.config.ts')).exists()) configs.push(dir.name);
  if (!configs.length) throw new Error('No widget build configurations found');
  for (const name of configs.sort()) await tool('vite', 'build', '--config', `src/widgets/${name}/vite.config.ts`);
}
async function frontendLint(): Promise<void> {
  await tool('eslint', 'src', 'scripts', 'vite.config.ts', 'vitest.config.ts', '--max-warnings=0');
  await tool('vue-tsc', '--noEmit');
  await tool('eslint', 'plugins/sonicboom/ui/src', 'plugins/sonicboom/ui/tests', 'plugins/sonicboom/shared', 'plugins/sonicboom/ui/vite.config.ts', 'plugins/sonicboom/ui/playwright.config.ts', '--max-warnings=0');
  await tool('vue-tsc', '--noEmit', '-p', 'plugins/sonicboom/ui/tsconfig.json');
}
async function rustLint(): Promise<void> {
  await cargo('fmt', '--all', '--', '--check');
  await cargo('clippy', '--workspace', '--all-targets', '--all-features', '--locked', '--', '-D', 'warnings');
}
async function tests(): Promise<void> {
  await run(bun, 'test', 'src/automation', 'src/plugin-ui', 'src/shared', 'src/widgets', 'scripts');
  await run(bun, 'test', 'plugins/sonicboom/shared', 'plugins/sonicboom/backend', 'plugins/sonicboom/ui/src');
  await tool('vitest', 'run');
}
async function build(): Promise<void> {
  await tool('vite', 'build');
  await tool('vite', 'build', '--config', 'plugins/sonicboom/ui/vite.config.ts');
  await script('build-sonicboom-backend.ts');
  await script('build-plugin.ts', '--all'); // stages and builds gateway widgets
  await cargo('build', '-p', 'tiktools-desktop', '--release', '--locked');
}
const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'start': await script('start-dev.ts', ...args); break;
  case 'dev': process.env.TIKTOOLS_SKIP_DEV_PLUGINS = '1'; await script('start-web-dev.ts', ...args); break;
  case 'build': await build(); break;
  case 'lint': await frontendLint(); await rustLint(); break;
  case 'ci':
    await script('generate-contracts.ts', '--check'); await script('check-tiktok-signer-revision.ts');
    await run(bun, 'scripts/check-universal.mjs'); await frontendLint(); await rustLint();
    await tests(); await cargo('test', '--workspace', '--locked');
    await cargo('test', '-p', 'tiktools-core', '--locked', '--features', 'native-tiktok', '--lib', 'e2e_batched_likes_trigger_saved_150_goals_without_breaking_old_templates');
    await cargo('test', '-p', 'tiktools-cli', '--features', 'local-web', '--locked');
    await cargo('test', '--manifest-path', 'examples/event-gateway-process-plugin/Cargo.toml', '--locked');
    await build(); break;
  case 'frontend-lint': await frontendLint(); break;
  case 'frontend-test': await tests(); break;
  case 'frontend-build': await tool('vite', 'build', ...args); break;
  case 'rust-lint': await rustLint(); break;
  case 'rust': await cargo(...args); break;
  case 'widgets': await widgets(); break;
  case 'plugins': await script('build-plugin.ts', ...args); break;
  case 'e2e': await tool('playwright', ...args.length ? args : ['test']); break;
  case 'package': await script('package-release.ts', ...args); break;
  case 'version': await script(args[0] === 'bump' ? 'bump-version.ts' : 'check-version.ts', ...args.slice(1)); break;
  case 'contracts': await script('generate-contracts.ts', ...args); break;
  case 'serve': await tool('vite', '--host', '127.0.0.1', ...args); break;
  case 'packaged': await script('start-packaged.ts', ...args); break;
  case 'prepare-plugins': await script('prepare-dev-plugins.ts', ...args); break;
  default: console.error('Usage: bun scripts/task.ts <start|dev|build|lint|ci|rust|widgets|plugins|e2e|package|version|contracts|serve>'); process.exitCode = 2;
}
