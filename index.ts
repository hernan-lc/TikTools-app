import { runPluginWorker } from './src/automation/plugins/plugin-worker.ts';
import { installProcessLogging, logApp } from './src/platform/logger.ts';

installProcessLogging();

async function main(): Promise<void> {
  if (process.argv.includes('--plugin-worker')) {
    await runPluginWorker(process.argv.slice(1));
    return;
  }

  const { runApp } = await import('./src/main.ts');
  await runApp();
}

void main().catch((error: unknown) => {
  logApp('error', 'Fatal TikTools startup failure.', error);
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
