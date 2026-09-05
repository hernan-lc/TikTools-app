import type {
  HostMessage,
  MediaPickerOptions,
  PageMessage,
} from '../../shared/messages.ts';

export type PluginInstallState = {
  installing: boolean;
  error: string;
  success: string;
  pendingPath: string;
  needsReplace: boolean;
};

export type PluginInstallResultMessage = Extract<HostMessage, { type: 'plugin-install-result' }>;

export function createInitialPluginInstallState(): PluginInstallState {
  return {
    installing: false,
    error: '',
    success: '',
    pendingPath: '',
    needsReplace: false,
  };
}

/** Native picker contract for `.plugin` packages. Never reads file bytes. */
export function pluginPickerOptions(title: string): MediaPickerOptions {
  return {
    mode: 'file',
    kind: 'other',
    title,
    extensions: ['plugin'],
  };
}

/** IPC sent after a successful native selection. Destination is host-owned. */
export function installPackageMessage(path: string, replaceExisting: boolean): PageMessage {
  return { type: 'install-plugin-package', path, replaceExisting };
}

export function startPluginInstall(path: string): PluginInstallState {
  return {
    installing: true,
    error: '',
    success: '',
    pendingPath: path,
    needsReplace: false,
  };
}

export function applyPluginInstallResult(
  state: PluginInstallState,
  message: PluginInstallResultMessage,
  translate: (key: string) => string,
): PluginInstallState {
  if (message.success) {
    return {
      installing: false,
      error: '',
      success: translate('pluginInstallSuccess'),
      pendingPath: '',
      needsReplace: false,
    };
  }
  if (message.code === 'already-installed') {
    return {
      ...state,
      installing: false,
      success: '',
      error: translate('pluginReplaceConfirm'),
      needsReplace: true,
    };
  }
  return {
    installing: false,
    error: message.error || translate('pluginInstallFailed'),
    success: '',
    pendingPath: '',
    needsReplace: false,
  };
}
