<script lang="tsx">
import { ref } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import type { MediaKind, MediaPickerMode, MediaSelection, OpenMediaPicker } from '../../../shared/messages.ts';
import type { JsonValue } from '../../../automation/types.ts';
import { TextInput } from './TextInput.vue';
import { t, type Locale } from '../../i18n.ts';

const AUDIO_EXTENSIONS = ['aac', 'flac', 'm4a', 'mp3', 'mp4', 'oga', 'ogg', 'opus', 'wav', 'webm'];

type MediaFieldProps = {
  locale: Locale;
  value: JsonValue | undefined;
  onValueChange: (value: JsonValue) => void;
  label: string;
  hint?: string;
  name?: string;
  disabled?: boolean;
  onOpenMediaPicker?: OpenMediaPicker;
  mode?: MediaPickerMode;
  kind?: MediaKind;
  extensions?: string[];
};

/**
 * A path input with an optional native picker. The selected value remains a
 * JSON path reference; no Blob, byte array, or copied asset is kept in the UI.
 */
export const MediaField = defineVueComponent<MediaFieldProps>(
  ['locale', 'value', 'onValueChange', 'label', 'hint', 'name', 'disabled', 'onOpenMediaPicker', 'mode', 'kind', 'extensions'],
  (props) => {
  const pickerError = ref('');

  const pick = (): void => {
    pickerError.value = '';
    const mode = props.mode ?? 'file';
    const kind = props.kind ?? 'audio';
    const extensions = props.extensions ?? (kind === 'audio' ? AUDIO_EXTENSIONS : undefined);
    props.onOpenMediaPicker?.(
      { mode, kind, extensions, title: props.label },
      (selection: MediaSelection | null, error?: string) => {
        if (error) {
          pickerError.value = error;
          return;
        }
        if (selection?.type === 'file') props.onValueChange(selection.file);
        if (selection?.type === 'directory') props.onValueChange(selection.directory);
      },
    );
  };

  return () => (
    <div class="ui-media-field">
      <div class="ui-media-field__input">
        <TextInput
          name={props.name}
          value={mediaPath(props.value)}
          onValueChange={(value) => { pickerError.value = ''; props.onValueChange(value); }}
          label={props.label}
          hint={props.hint}
          disabled={props.disabled}
        />
      </div>
      {props.onOpenMediaPicker ? (
        <button
          type="button"
          class="plg-btn ui-media-field__browse"
          onClick={pick}
          disabled={props.disabled}
          aria-label={props.label}
        >
          {mediaPath(props.value) ? t(props.locale, 'changeMedia') : t(props.locale, 'browseMedia')}
        </button>
      ) : null}
      {pickerError.value ? <small class="ui-media-field__error" role="alert">{pickerError.value}</small> : null}
    </div>
  );
  },
);

export default MediaField;

function mediaPath(value: JsonValue | undefined): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const path = value.path;
    if (typeof path === 'string') return path;
  }
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value) ?? '';
}
</script>
