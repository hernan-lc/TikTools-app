import { computed, ref, watch } from 'vue';
import type { VNode } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';
import { applyFetchUrlTemplate, type FetchUrlTemplate, type TemplateSuggestion } from './template-suggestions.ts';
import type { AutocompleteItem } from '../autocomplete/autocomplete.ts';
import { filterSuggestions, highlightSegments } from '../autocomplete/autocomplete.ts';
import { AutocompletePortal } from './AutocompletePortal.tsx';
import { InfoTip } from '../ui/InfoTip.tsx';
import { t, type Locale } from '../../i18n.ts';

/** Anything list-like works: TemplateSuggestion is an AutocompleteItem. */
export type TemplateFieldSuggestion = TemplateSuggestion | AutocompleteItem;

type TemplateFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: TemplateFieldSuggestion[];
  suggestionMode?: 'template' | 'path';
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  ariaLabel?: string;
  /** Kept for compatibility; no longer rendered (see dropdown footer). */
  hintText?: string;
  /** MUI-style floating label. When set, label lives inside until focus/filled. */
  label?: string;
  /** Tooltip-only explanation (ⓘ) attached to the floating label. */
  hint?: string;
  /** Kept for compatibility; the `{{ }}` badge was removed in favor of inline highlight. */
  template?: boolean;
  templateHint?: string;
  locale?: Locale;
  /**
   * When false, the dropdown only opens inside `{{ }}` or via Ctrl+Space.
   * Used by URL inputs so typing a hostname (e.g. `localhost`) never pops
   * event-variable suggestions or hijacks Tab.
   */
  bareWordTrigger?: boolean;
  /**
   * Quick URL targets (e.g. `localhost:3000`) offered at the top of the same
   * autocomplete dropdown while typing a URL. Picking one swaps only the
   * origin, keeping the typed path/query. Pass together with
   * `bareWordTrigger={false}` so bare words match presets, not variables.
   */
  urlPresets?: FetchUrlTemplate[];
};

/** URL preset as an autocomplete row: matched by label or URL, applied raw. */
function toPresetItem(preset: FetchUrlTemplate): AutocompleteItem & { label: string; value: string; preset: FetchUrlTemplate } {
  return {
    value: preset.url,
    label: preset.label,
    kind: 'snippet',
    detail: 'preset',
    documentation: preset.hint ?? preset.url,
    preview: preset.label,
    preset,
  };
}

function toItem(suggestion: TemplateFieldSuggestion): AutocompleteItem & { label: string; value: string } {
  const item = suggestion as AutocompleteItem;
  return {
    value: String((suggestion as { value: unknown }).value ?? ''),
    label: String((suggestion as { label: unknown }).label ?? (suggestion as { value: unknown }).value ?? ''),
    kind: item.kind,
    detail: item.detail ?? (item.kind ? String(item.kind) : undefined),
    documentation: item.documentation,
    preview: item.preview,
  };
}

/** Drop duplicate values (first wins) so merged scopes never list a path twice. */
function dedupeItems<T extends { value: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((entry) => {
    if (!entry.value || seen.has(entry.value)) return false;
    seen.add(entry.value);
    return true;
  });
}

/**
 * Small, dependency-free template editor. The stored value stays the runtime
 * format (`{{ event.data.comment }}`); `{{ … }}` spans render in cyan behind
 * the text so variables read as variables everywhere.
 *
 * Autocomplete is deliberately quiet: it opens only while typing inside
 * `{{ }}`, while typing a variable-like word (2+ chars), or via Ctrl+Space.
 */
export const TemplateField = defineVueComponent<TemplateFieldProps>(
  [
    'value',
    'onValueChange',
    'suggestions',
    'suggestionMode',
    'placeholder',
    'multiline',
    'rows',
    'ariaLabel',
    'hintText',
    'label',
    'hint',
    'template',
    'templateHint',
    'locale',
    'bareWordTrigger',
    'urlPresets',
  ],
  (props) => {
  const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const fieldRef = ref<HTMLDivElement | null>(null);
  const focused = ref(false);
  const forcedOpen = ref(false);
  const cursor = ref(props.value.length);
  const suggestionIndex = ref(0);

  const updateCursor = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    cursor.value = target.selectionStart ?? target.value.length;
  };

  const syncHighlightScroll = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    const backdrop = target.parentElement?.querySelector<HTMLElement>(':scope > .tpl-highlight');
    if (backdrop) {
      backdrop.scrollTop = target.scrollTop;
      backdrop.scrollLeft = target.scrollLeft;
    }
  };

  const suggestionMode = computed(() => props.suggestionMode ?? 'template');
  const token = computed(() => getToken(props.value, cursor.value, suggestionMode.value));
  const items = computed(() => dedupeItems(props.suggestions.map(toItem)));
  // URL mode: presets live in the same dropdown; bare words match presets
  // only, variables stay behind `{{ }}` / Ctrl+Space.
  const urlMode = computed(() => suggestionMode.value === 'template' && Boolean(props.urlPresets && props.urlPresets.length > 0));
  const presetItems = computed(() => (urlMode.value ? (props.urlPresets ?? []).map(toPresetItem) : []));
  const scoredPresets = computed(() => (
    urlMode.value && !token.value.inside ? filterSuggestions(presetItems.value, token.value.query, 8) : []
  ));
  const scored = computed(() => filterSuggestions(items.value, token.value.query, 7));
  const presetRows = computed(() => scoredPresets.value.map((entry) => ({
    key: `preset:${entry.item.preset.id}`,
    preset: entry.item.preset as FetchUrlTemplate,
    item: entry.item,
    ranges: entry.matchRanges,
  })));
  const variableRows = computed(() => scored.value.map((entry) => ({
    key: `var:${entry.item.value}`,
    preset: undefined as FetchUrlTemplate | undefined,
    item: entry.item,
    ranges: entry.matchRanges,
  })));
  const showPresetRows = computed(() => presetRows.value.length > 0 && (forcedOpen.value || token.value.query.length >= 1));
  const bareWordHit = computed(() => (
    suggestionMode.value === 'path'
      ? token.value.query.length >= 1
      : (props.bareWordTrigger ?? true) && token.value.query.length >= 2
  ));
  const wantsOpenVars = computed(() => forcedOpen.value || token.value.inside || (!urlMode.value && bareWordHit.value));
  const showVariableRows = computed(() => wantsOpenVars.value && variableRows.value.length > 0);
  const visible = computed(() => [
    ...(showPresetRows.value ? presetRows.value : []),
    ...(showVariableRows.value ? variableRows.value : []),
  ]);
  const showSuggestions = computed(() => focused.value && visible.value.length > 0);

  watch(() => [token.value.query, props.suggestions.length, presetItems.value.length], () => {
    suggestionIndex.value = 0;
  });

  watch(showSuggestions, (open) => {
    if (!open) forcedOpen.value = false;
  });

  const insertSuggestion = (suggestion: { value: string }): void => {
    const element = inputRef.value;
    const offset = element?.selectionStart ?? cursor.value;
    const current = getToken(props.value, offset, suggestionMode.value);
    // Replace the exact range being typed: the `{{ …` span when inside
    // braces, the bare word (`event.us`) when completing outside them.
    // Inserting at the cursor without replacing duplicated the word.
    const start = suggestionMode.value === 'path' || current.inside || current.query.length > 0 ? current.start : offset;
    const inserted = suggestionMode.value === 'path' ? suggestion.value : `{{ ${suggestion.value} }}`;
    const nextValue = `${props.value.slice(0, start)}${inserted}${props.value.slice(offset)}`;
    const nextCursor = start + inserted.length;
    props.onValueChange(nextValue);
    cursor.value = nextCursor;
    forcedOpen.value = false;
    requestAnimationFrame(() => {
      inputRef.value?.focus();
      inputRef.value?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  /** URL preset pick: swap only the origin, keeping the typed path/query. */
  const insertPreset = (preset: FetchUrlTemplate): void => {
    const nextValue = applyFetchUrlTemplate(props.value, preset.url);
    const nextCursor = nextValue.length;
    props.onValueChange(nextValue);
    cursor.value = nextCursor;
    forcedOpen.value = false;
    requestAnimationFrame(() => {
      inputRef.value?.focus();
      inputRef.value?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleSuggestionKeydown = (event: KeyboardEvent): void => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key === ' ') {
      event.preventDefault();
      forcedOpen.value = true;
      focused.value = true;
      return;
    }
    if (!showSuggestions.value || visible.value.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      suggestionIndex.value = (suggestionIndex.value + 1) % visible.value.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      suggestionIndex.value = (suggestionIndex.value - 1 + visible.value.length) % visible.value.length;
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      // Enter on multiline without a query inserts a newline; Tab always picks.
      if (event.key === 'Enter' && (props.multiline ?? false) && !token.value.inside && !forcedOpen.value && token.value.query.length < 2) return;
      event.preventDefault();
      const selected = visible.value[suggestionIndex.value];
      if (selected?.preset) insertPreset(selected.preset);
      else if (selected) insertSuggestion(selected.item);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (forcedOpen.value) forcedOpen.value = false;
      else focused.value = false;
      (event.currentTarget as HTMLElement).blur?.();
    }
  };

  return () => {
  const multiline = props.multiline ?? false;
  const rows = props.rows ?? 4;
  const locale = props.locale ?? 'en';
  const shared = {
    'aria-label': props.ariaLabel,
    spellcheck: false,
    onFocus: () => { focused.value = true; },
    onBlur: () => {
      focused.value = false;
      forcedOpen.value = false;
    },
    onKeydown: handleSuggestionKeydown,
    onInput: (event: Event) => {
      const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
      props.onValueChange(target.value);
      updateCursor(event);
    },
    onKeyup: updateCursor,
    onSelect: updateCursor,
    onClick: updateCursor,
    onScroll: syncHighlightScroll,
  } as const;

  const highlight = renderHighlight(props.value);

  const control = multiline ? (
    <textarea
      ref={(element) => { inputRef.value = element as HTMLTextAreaElement | null; }}
      class="node-editor-template-control node-editor-template-control--textarea tpl-transparent"
      value={props.value}
      rows={rows}
      placeholder={props.label ? ' ' : props.placeholder}
      {...shared}
    />
  ) : (
    <input
      ref={(element) => { inputRef.value = element as HTMLInputElement | null; }}
      class="node-editor-template-control tpl-transparent"
      type="text"
      value={props.value}
      placeholder={props.label ? ' ' : props.placeholder}
      {...shared}
    />
  );

  const presetCount = showPresetRows.value ? presetRows.value.length : 0;
  const dropdown = (
    <AutocompletePortal anchorRef={fieldRef} cursorRef={inputRef} cursorOffset={cursor.value} open={showSuggestions.value}>
      <div class="tpl-suggest" role="listbox" aria-label={props.ariaLabel ?? props.label ?? 'Suggestions'}>
        {presetCount > 0 && <div class="tpl-group">{t(locale, 'behavior.editor.urlPresets')}</div>}
        {visible.value.map(({ key, preset, item, ranges }, index) => (
          <SuggestionRow
            key={key}
            item={item}
            ranges={ranges}
            selected={index === suggestionIndex.value}
            onHover={() => { suggestionIndex.value = index; }}
            onPick={() => (preset ? insertPreset(preset) : insertSuggestion(item))}
          />
        ))}
        <div class="tpl-foot">{t(locale, 'autocompleteNavigateInsert')}</div>
      </div>
    </AutocompletePortal>
  );

  if (props.label) {
    const filled = props.value.trim().length > 0;
    return (
      <div ref={fieldRef} class={`node-editor-template-field node-editor-template-field--float ${filled ? 'is-filled' : ''} ${multiline ? 'is-multiline' : ''}`}>
        <div class="node-editor-template-control-wrap">
          <div class={`tpl-edit${multiline ? ' tpl-edit--multi' : ''}`}>
            <div class="tpl-highlight" aria-hidden="true">{highlight}</div>
            {control}
          </div>
          <label class="node-editor-float-label">
            <span class="node-editor-float-label__text">{props.label}</span>
            {props.hint ? <InfoTip text={props.hint} position="right" /> : null}
          </label>
        </div>
        {dropdown}
      </div>
    );
  }

  return (
    <div ref={fieldRef} class="node-editor-template-field">
      <div class="node-editor-template-control-wrap">
        <div class={`tpl-edit${multiline ? ' tpl-edit--multi' : ''}`}>
          <div class="tpl-highlight" aria-hidden="true">{highlight}</div>
          {control}
        </div>
      </div>
      {dropdown}
    </div>
  );
  };
  },
);

/** Inline `{{ … }}` highlight, including the unclosed `{{ …` state while typing. */
function renderHighlight(value: string): VNode[] | string {
  if (!value) return '';
  const parts = value.split(/(\{\{\s*[^}{]*\}?\}?)/g);
  return parts.map((part, index) => {
    if (index % 2 === 1) return <span key={index} class="tpl-var">{part || '{{'}</span>;
    return <span key={index}>{part}</span>;
  });
}

function SuggestionRow({
  item,
  ranges,
  selected,
  onHover,
  onPick,
}: {
  item: AutocompleteItem & { label: string; value: string };
  ranges: Array<{ start: number; end: number }>;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const valueSegments = highlightSegments(item.value, ranges);
  const hoverTitle = [
    item.value,
    item.detail ?? item.kind ? `type: ${item.detail ?? item.kind}` : '',
    item.preview ? `= ${item.preview}` : '',
    item.documentation ?? '',
  ].filter(Boolean).join('\n');
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      class={selected ? 'is-selected' : ''}
      title={hoverTitle || item.value}
      onMousedown={(event) => event.preventDefault()}
      onMouseenter={onHover}
      onFocus={onHover}
      onClick={onPick}
    >
      <i class={`tpl-dot tpl-dot--${item.kind ?? 'unknown'}`} aria-hidden="true" />
      <code class="tpl-path">
        {valueSegments.map((segment, index) => (
          segment.highlight ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>
        ))}
      </code>
      {item.detail ?? item.kind ? <span class="tpl-kind">{item.detail ?? item.kind}</span> : null}
      {item.preview ? <span class="tpl-preview" title={item.preview}>{item.preview}</span> : null}
    </button>
  );
}

type Token = { start: number; query: string; inside: boolean };

function getToken(value: string, cursor: number, mode: 'template' | 'path'): Token {
  const before = value.slice(0, cursor);
  if (mode === 'template') {
    const start = before.lastIndexOf('{{');
    if (start >= 0 && !before.slice(start).includes('}}')) {
      return { start, query: before.slice(start + 2).trim(), inside: true };
    }
    // Outside braces: track the word being typed so `event.us` still suggests.
    const match = before.match(/[A-Za-z0-9_$.]*$/);
    const word = match?.[0] ?? '';
    return { start: cursor - word.length, query: word, inside: false };
  }

  const match = before.match(/[A-Za-z0-9_$.]*$/);
  const text = match?.[0] ?? '';
  return { start: cursor - text.length, query: text, inside: true };
}
