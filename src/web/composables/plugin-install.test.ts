import { describe, expect, test } from 'bun:test';

import type { PageMessage } from '../../shared/messages.ts';
import {
  applyPluginInstallResult,
  createInitialPluginInstallState,
  installPackageMessage,
  pluginPickerOptions,
  startPluginInstall,
} from './plugin-install.ts';

function translate(key: string): string {
  return key;
}

describe('plugin package picker contract', () => {
  test('requests a native .plugin file without touching bytes', () => {
    const options = pluginPickerOptions('Select a TikTools plugin');
    expect(options.mode).toBe('file');
    expect(options.kind).toBe('other');
    expect(options.extensions).toEqual(['plugin']);
    expect(options.title).toBe('Select a TikTools plugin');
  });

  test('install message carries only a path and replace flag', () => {
    const first = installPackageMessage('/tmp/demo.plugin', false) as Extract<
      PageMessage,
      { type: 'install-plugin-package' }
    >;
    expect(first.type).toBe('install-plugin-package');
    expect(first.path).toBe('/tmp/demo.plugin');
    expect(first.replaceExisting).toBe(false);

    const replace = installPackageMessage('/tmp/demo.plugin', true) as Extract<
      PageMessage,
      { type: 'install-plugin-package' }
    >;
    expect(replace.replaceExisting).toBe(true);
    // The frontend never chooses a destination or plugin id.
    expect('id' in replace).toBe(false);
    expect('destination' in replace).toBe(false);
  });
});

describe('plugin install state machine', () => {
  test('starting an install tracks the pending path and loading state', () => {
    const state = startPluginInstall('/tmp/demo.plugin');
    expect(state.installing).toBe(true);
    expect(state.pendingPath).toBe('/tmp/demo.plugin');
    expect(state.needsReplace).toBe(false);
    expect(state.error).toBe('');
  });

  test('successful install clears loading and shows success', () => {
    const pending = startPluginInstall('/tmp/demo.plugin');
    const next = applyPluginInstallResult(
      pending,
      { type: 'plugin-install-result', success: true, id: 'demo', version: '1.0.0', replaced: false },
      translate,
    );
    expect(next.installing).toBe(false);
    expect(next.error).toBe('');
    expect(next.success).toBe('pluginInstallSuccess');
    expect(next.pendingPath).toBe('');
    expect(next.needsReplace).toBe(false);
  });

  test('failure displays the backend error', () => {
    const pending = startPluginInstall('/tmp/demo.plugin');
    const next = applyPluginInstallResult(
      pending,
      { type: 'plugin-install-result', success: false, code: 'invalid-package', error: 'bad archive' },
      translate,
    );
    expect(next.installing).toBe(false);
    expect(next.error).toBe('bad archive');
    expect(next.success).toBe('');
    expect(next.needsReplace).toBe(false);
  });

  test('already-installed keeps the path so replace can retry with confirmation', () => {
    const pending = startPluginInstall('/tmp/demo.plugin');
    const next = applyPluginInstallResult(
      pending,
      { type: 'plugin-install-result', success: false, code: 'already-installed', error: 'already here' },
      translate,
    );
    expect(next.needsReplace).toBe(true);
    expect(next.pendingPath).toBe('/tmp/demo.plugin');
    // The UI keys off the structured code, not the message text.
    expect(next.error).toBe('pluginReplaceConfirm');

    const retry = installPackageMessage(next.pendingPath, true) as Extract<
      PageMessage,
      { type: 'install-plugin-package' }
    >;
    expect(retry.replaceExisting).toBe(true);
  });

  test('picker cancellation is represented by untouched initial state', () => {
    const initial = createInitialPluginInstallState();
    expect(initial.installing).toBe(false);
    expect(initial.pendingPath).toBe('');
    expect(initial.error).toBe('');
    expect(initial.success).toBe('');
  });
});
