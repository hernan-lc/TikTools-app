import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
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
export function TemplateField({
  value,
  onValueChange,
  suggestions,
  suggestionMode = 'template',
  placeholder,
  multiline = false,
  rows = 4,
  ariaLabel,
  label,
  hint,
  locale = 'en',
  bareWordTrigger = true,
  urlPresets,
}: TemplateFieldProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [forcedOpen, setForcedOpen] = useState(false);
  const [cursor, setCursor] = useState(value.length);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const updateCursor = (event: JSX.TargetedEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
  };

  const syncHighlightScroll = (event: JSX.TargetedEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const target = event.currentTarget;
    const backdrop = target.parentElement?.querySelector<HTMLElement>(':scope > .tpl-highlight');
    if (backdrop) {
      backdrop.scrollTop = target.scrollTop;
      backdrop.scrollLeft = target.scrollLeft;
    }
  };

  const token = getToken(value, cursor, suggestionMode);
  const items = useMemo(() => dedupeItems(suggestions.map(toItem)), [suggestions]);
  // URL mode: presets live in the same dropdown; bare words match presets
  // only, variables stay behind `{{ }}` / Ctrl+Space.
  const urlMode = suggestionMode === 'template' && Boolean(urlPresets && urlPresets.length > 0);
  const presetItems = useMemo(
    () => (urlMode ? (urlPresets ?? []).map(toPresetItem) : []),
    [urlMode, urlPresets],
  );
  const scoredPresets = useMemo(
    () => (urlMode && !token.inside ? filterSuggestions(presetItems, token.query, 8) : []),
    [urlMode, presetItems, token.inside, token.query],
  );
  const scored = useMemo(() => filterSuggestions(items, token.query, 7), [items, token.query]);
  const presetRows = scoredPresets.map((entry) => ({
    key: `preset:${entry.item.preset.id}`,
    preset: entry.item.preset as FetchUrlTemplate,
    item: entry.item,
    ranges: entry.matchRanges,
  }));
  const variableRows = scored.map((entry) => ({
    key: `var:${entry.item.value}`,
    preset: undefined as FetchUrlTemplate | undefined,
    item: entry.item,
    ranges: entry.matchRanges,
  }));
  const showPresetRows = presetRows.length > 0 && (forcedOpen || token.query.length >= 1);
  const bareWordHit = suggestionMode === 'path' ? token.query.length >= 1 : bareWordTrigger && token.query.length >= 2;
  const wantsOpenVars = forcedOpen || token.inside || (!urlMode && bareWordHit);
  const showVariableRows = wantsOpenVars && variableRows.length > 0;
  const visible = [...(showPresetRows ? presetRows : []), ...(showVariableRows ? variableRows : [])];
  const showSuggestions = focused && visible.length > 0;

  useEffect(() => {
    setSuggestionIndex(0);
  }, [token.query, suggestions.length, presetItems.length]);

  useEffect(() => {
    if (!showSuggestions) setForcedOpen(false);
  }, [showSuggestions]);

  const insertSuggestion = (suggestion: { value: string }): void => {
    const element = inputRef.current;
    const offset = element?.selectionStart ?? cursor;
    const current = getToken(value, offset, suggestionMode);
    // Replace the exact range being typed: the `{{ …` span when inside
    // braces, the bare word (`event.us`) when completing outside them.
    // Inserting at the cursor without replacing duplicated the word.
    const start = suggestionMode === 'path' || current.inside || current.query.length > 0 ? current.start : offset;
    const inserted = suggestionMode === 'path' ? suggestion.value : `{{ ${suggestion.value} }}`;
    const nextValue = `${value.slice(0, start)}${inserted}${value.slice(offset)}`;
    const nextCursor = start + inserted.length;
    onValueChange(nextValue);
    setCursor(nextCursor);
    setForcedOpen(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  /** URL preset pick: swap only the origin, keeping the typed path/query. */
  const insertPreset = (preset: FetchUrlTemplate): void => {
    const nextValue = applyFetchUrlTemplate(value, preset.url);
    const nextCursor = nextValue.length;
    onValueChange(nextValue);
    setCursor(nextCursor);
    setForcedOpen(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleSuggestionKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key === ' ') {
      event.preventDefault();
      setForcedOpen(true);
      setFocused(true);
      return;
    }
    if (!showSuggestions || visible.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSuggestionIndex((current) => (current + 1) % visible.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSuggestionIndex((current) => (current - 1 + visible.length) % visible.length);
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      // Enter on multiline without a query inserts a newline; Tab always picks.
      if (event.key === 'Enter' && multiline && !token.inside && !forcedOpen && token.query.length < 2) return;
      event.preventDefault();
      const selected = visible[suggestionIndex];
      if (selected?.preset) insertPreset(selected.preset);
      else if (selected) insertSuggestion(selected.item);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (forcedOpen) setForcedOpen(false);
      else setFocused(false);
      (event.currentTarget as HTMLElement).blur?.();
    }
  };

  const shared = {
    'aria-label': ariaLabel,
    spellcheck: false,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      setForcedOpen(false);
    },
    onKeyDown: handleSuggestionKeyDown,
    onInput: (event: JSX.TargetedEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onValueChange(event.currentTarget.value);
      updateCursor(event);
    },
    onKeyUp: updateCursor,
    onSelect: updateCursor,
    onClick: updateCursor,
    onScroll: syncHighlightScroll,
  } as const;

  const highlight = useMemo(() => renderHighlight(value), [value]);

  const control = multiline ? (
    <textarea
      ref={(element) => { inputRef.current = element; }}
      className="node-editor-template-control node-editor-template-control--textarea tpl-transparent"
      value={value}
      rows={rows}
      placeholder={label ? ' ' : placeholder}
      {...shared}
    />
  ) : (
    <input
      ref={(element) => { inputRef.current = element; }}
      className="node-editor-template-control tpl-transparent"
      type="text"
      value={value}
      placeholder={label ? ' ' : placeholder}
      {...shared}
    />
  );

  const presetCount = showPresetRows ? presetRows.length : 0;
  const dropdown = (
    <AutocompletePortal anchorRef={fieldRef} cursorRef={inputRef} cursorOffset={cursor} open={showSuggestions}>
      <div className="tpl-suggest" role="listbox" aria-label={ariaLabel ?? label ?? 'Suggestions'}>
        {presetCount > 0 && <div className="tpl-group">{t(locale, 'behavior.editor.urlPresets')}</div>}
        {visible.map(({ key, preset, item, ranges }, index) => (
          <SuggestionRow
            key={key}
            item={item}
            ranges={ranges}
            selected={index === suggestionIndex}
            onHover={() => setSuggestionIndex(index)}
            onPick={() => (preset ? insertPreset(preset) : insertSuggestion(item))}
          />
        ))}
        <div className="tpl-foot">{t(locale, 'autocompleteNavigateInsert')}</div>
      </div>
    </AutocompletePortal>
  );

  if (label) {
    const filled = value.trim().length > 0;
    return (
      <div ref={fieldRef} className={`node-editor-template-field node-editor-template-field--float ${filled ? 'is-filled' : ''} ${multiline ? 'is-multiline' : ''}`}>
        <div className="node-editor-template-control-wrap">
          <div className={`tpl-edit${multiline ? ' tpl-edit--multi' : ''}`}>
            <div className="tpl-highlight" aria-hidden="true">{highlight}</div>
            {control}
          </div>
          <label className="node-editor-float-label">
            <span className="node-editor-float-label__text">{label}</span>
            {hint ? <InfoTip text={hint} position="right" /> : null}
          </label>
        </div>
        {dropdown}
      </div>
    );
  }

  return (
    <div ref={fieldRef} className="node-editor-template-field">
      <div className="node-editor-template-control-wrap">
        <div className={`tpl-edit${multiline ? ' tpl-edit--multi' : ''}`}>
          <div className="tpl-highlight" aria-hidden="true">{highlight}</div>
          {control}
        </div>
      </div>
      {dropdown}
    </div>
  );
}

/** Inline `{{ … }}` highlight, including the unclosed `{{ …` state while typing. */
function renderHighlight(value: string): JSX.Element[] | string {
  if (!value) return '';
  const parts = value.split(/(\{\{\s*[^}{]*\}?\}?)/g);
  return parts.map((part, index) => {
    if (index % 2 === 1) return <span key={index} className="tpl-var">{part || '{{'}</span>;
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
      className={selected ? 'is-selected' : ''}
      title={hoverTitle || item.value}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onPick}
    >
      <i className={`tpl-dot tpl-dot--${item.kind ?? 'unknown'}`} aria-hidden="true" />
      <code className="tpl-path">
        {valueSegments.map((segment, index) => (
          segment.highlight ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>
        ))}
      </code>
      {item.detail ?? item.kind ? <span className="tpl-kind">{item.detail ?? item.kind}</span> : null}
      {item.preview ? <span className="tpl-preview" title={item.preview}>{item.preview}</span> : null}
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
