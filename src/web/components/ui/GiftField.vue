<script lang="tsx">
import { ref } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import type { JsonValue } from '../../../automation/types.ts';
import { t, type Locale } from '../../i18n.ts';
import { GiftPicker } from './GiftPicker.vue';
import { TextInput } from './TextInput.vue';
import { giftCatalogEntriesFromOptions } from './gift-field-options.ts';
import type { FieldOption } from './schema-form-helpers.ts';

type GiftFieldProps = {
  locale: Locale;
  name: string;
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  error?: string;
  /** Dynamic options from `host.gifts` (with gift metadata); absent while loading or when empty. */
  fieldOptions?: FieldOption[];
  onValueChange: (value: JsonValue) => void;
};

/**
 * A gift-name field for plugin configuration: free text with a Browse
 * button opening the shared `GiftPicker` (icon, name, diamond price,
 * search, manual entry). The stored value stays a plain gift name, exactly
 * what event filters use — nothing Minecraft- or plugin-specific.
 */
export const GiftField = defineVueComponent<GiftFieldProps>(
  ['locale', 'name', 'label', 'hint', 'value', 'placeholder', 'error', 'fieldOptions', 'onValueChange'],
  (props) => {
    const open = ref(false);

    return () => (
      <div class="ui-media-field">
        <div class="ui-media-field__input">
          <TextInput
            name={props.name}
            value={props.value}
            onValueChange={(next) => props.onValueChange(next)}
            label={props.label}
            hint={props.hint}
            placeholder={props.placeholder}
            error={props.error}
          />
        </div>
        <button
          type="button"
          class="plg-btn ui-media-field__browse"
          onClick={() => { open.value = true; }}
          aria-label={props.label}
        >
          {props.value ? t(props.locale, 'changeMedia') : t(props.locale, 'browseMedia')}
        </button>
        {open.value ? (
          <GiftPicker
            locale={props.locale}
            gifts={giftCatalogEntriesFromOptions(props.fieldOptions)}
            selected={props.value ? [props.value] : []}
            onPick={(values) => {
              props.onValueChange(values[0] ?? '');
              open.value = false;
            }}
            onClose={() => { open.value = false; }}
          />
        ) : null}
      </div>
    );
  },
);

export default GiftField;
</script>
