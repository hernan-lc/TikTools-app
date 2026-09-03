import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { TemplateSuggestion } from './template-suggestions.ts';
import type { AutocompleteItem } from '../autocomplete/autocomplete.ts';
import { filterSuggestions, highlightSegments } from '../autocomplete/autocomplete.ts';
import { AutocompletePortal } from './AutocompletePortal.tsx';
import { InfoTip } from '../ui/InfoTip.tsx';

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
  /** Ctrl/Cmd+Space always reopens; Escape closes. */
  hintText?: string;
  /** MUI-style floating label. When set, label lives inside until focus/filled. */
  label?: string;
  /** Tooltip-only explanation (ⓘ) attached to the floating label. */
  hint?: string;
  /** Show the `{{ }}` badge inside the control. */
  template?: boolean;
  templateHint?: string;
};

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

/**
 * Small, dependency-free template editor. It keeps the stored value as the
 * runtime expects (`{{ event.data.comment }}`) while letting users insert
 * valid paths instead of memorising the event shape.
 *
 * Generic: push any object/schema via `suggestions` (see `autocomplete.ts`).
 * Matches highlight with `<mark>`; hovering (or keyboard-moving) shows the
 * value/type in the detail pane.
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
  hintText,
  label,
  hint,
  template,
  templateHint,
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

  const token = getToken(value, cursor, suggestionMode);
  const items = useMemo(() => suggestions.map(toItem), [suggestions]);
  const scored = useMemo(() => filterSuggestions(items, token.query, 10), [items, token.query]);
  const visible = scored.map((entry) => ({ item: entry.item, ranges: entry.matchRanges }));
  const showSuggestions = (focused || forcedOpen) && (token.active || forcedOpen) && visible.length > 0;
  const activeEntry = visible[Math.min(suggestionIndex, Math.max(0, visible.length - 1))];

  useEffect(() => {
    setSuggestionIndex(0);
  }, [token.query, suggestions.length]);

  useEffect(() => {
    if (!showSuggestions) setForcedOpen(false);
  }, [showSuggestions]);

  const insertSuggestion = (suggestion: { value: string }): void => {
    const element = inputRef.current;
    const offset = element?.selectionStart ?? cursor;
    const current = getToken(value, offset, suggestionMode);
    const openToken = suggestionMode === 'template' && current.start < offset;
    const start = suggestionMode === 'path' || openToken ? current.start : offset;
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
      // Enter on multiline without an open token inserts a newline; Tab always picks.
      if (event.key === 'Enter' && multiline && !token.active && !forcedOpen) return;
      event.preventDefault();
      const selected = visible[suggestionIndex]?.item;
      if (selected) insertSuggestion(selected);
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
  } as const;

  const control = multiline ? (
    <textarea
      ref={(element) => { inputRef.current = element; }}
      className="node-editor-template-control node-editor-template-control--textarea"
      value={value}
      rows={rows}
      placeholder={label ? ' ' : placeholder}
      {...shared}
    />
  ) : (
    <input
      ref={(element) => { inputRef.current = element; }}
      className="node-editor-template-control"
      type="text"
      value={value}
      placeholder={label ? ' ' : placeholder}
      {...shared}
    />
  );

  if (label) {
    const filled = value.trim().length > 0;
    return (
      <div ref={fieldRef} className={`node-editor-template-field node-editor-template-field--float ${filled ? 'is-filled' : ''} ${multiline ? 'is-multiline' : ''}`}>
        <div className="node-editor-template-control-wrap">
          {control}
          <label className="node-editor-float-label">
            <span className="node-editor-float-label__text">{label}</span>
            {hint ? <InfoTip text={hint} position="right" /> : null}
          </label>
          {template ? (
            <span
              className="node-editor-float-badge"
              data-tooltip={templateHint ?? 'Accepts {{ event.* }}'}
              data-tooltip-pos="left"
              data-tooltip-wide=""
            >
              {'{{ }}'}
            </span>
          ) : null}
        </div>
        <AutocompletePortal anchorRef={fieldRef} cursorRef={inputRef} cursorOffset={cursor} open={showSuggestions}>
          <div className="node-editor-template-suggestions node-editor-template-suggestions--rich" role="listbox" aria-label={ariaLabel ?? label ?? 'Suggestions'}>
            <div className="node-editor-template-suggestions__list">
              {visible.map(({ item, ranges }, index) => (
                <SuggestionRow
                  key={item.value}
                  item={item}
                  ranges={ranges}
                  selected={index === suggestionIndex}
                  onHover={() => setSuggestionIndex(index)}
                  onPick={() => insertSuggestion(item)}
                />
              ))}
            </div>
            {activeEntry ? (
              <div className="node-editor-template-suggestions__detail" role="note">
                <code className="node-editor-template-suggestions__detail-path">{activeEntry.item.value}</code>
                <div className="node-editor-template-suggestions__detail-meta">
                  {activeEntry.item.detail ?? activeEntry.item.kind ? (
                    <span className="node-editor-template-suggestions__type">{activeEntry.item.detail ?? activeEntry.item.kind}</span>
                  ) : null}
                  {activeEntry.item.preview ? (
                    <span className="node-editor-template-suggestions__preview" title={activeEntry.item.preview}>
                      = {activeEntry.item.preview}
                    </span>
                  ) : null}
                </div>
                {activeEntry.item.documentation ? (
                  <span className="node-editor-template-suggestions__doc">{activeEntry.item.documentation}</span>
                ) : null}
                {!activeEntry.item.documentation && !activeEntry.item.preview ? (
                  <span className="node-editor-template-suggestions__doc node-editor-template-suggestions__doc--muted">
                    {hintText ?? 'Tab ↵ · ↑ ↓'}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </AutocompletePortal>
      </div>
    );
  }

  return (
    <div ref={fieldRef} className="node-editor-template-field">
      <div className="node-editor-template-control-wrap">{control}</div>
      <AutocompletePortal anchorRef={fieldRef} cursorRef={inputRef} cursorOffset={cursor} open={showSuggestions}>
        <div className="node-editor-template-suggestions node-editor-template-suggestions--rich" role="listbox" aria-label={ariaLabel ?? 'Suggestions'}>
          <div className="node-editor-template-suggestions__list">
            {visible.map(({ item, ranges }, index) => (
              <SuggestionRow
                key={item.value}
                item={item}
                ranges={ranges}
                selected={index === suggestionIndex}
                onHover={() => setSuggestionIndex(index)}
                onPick={() => insertSuggestion(item)}
              />
            ))}
          </div>
          {activeEntry ? (
            <div className="node-editor-template-suggestions__detail" role="note">
              <code className="node-editor-template-suggestions__detail-path">{activeEntry.item.value}</code>
              <div className="node-editor-template-suggestions__detail-meta">
                {activeEntry.item.detail ?? activeEntry.item.kind ? (
                  <span className="node-editor-template-suggestions__type">{activeEntry.item.detail ?? activeEntry.item.kind}</span>
                ) : null}
                {activeEntry.item.preview ? (
                  <span className="node-editor-template-suggestions__preview" title={activeEntry.item.preview}>
                    = {activeEntry.item.preview}
                  </span>
                ) : null}
              </div>
              {activeEntry.item.documentation ? (
                <span className="node-editor-template-suggestions__doc">{activeEntry.item.documentation}</span>
              ) : null}
              {!activeEntry.item.documentation && !activeEntry.item.preview ? (
                <span className="node-editor-template-suggestions__doc node-editor-template-suggestions__doc--muted">
                  {hintText ?? 'Tab ↵ to insert · ↑ ↓ to navigate'}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </AutocompletePortal>
    </div>
  );
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
  const labelSegments = highlightSegments(item.label, []);
  // Highlight against the value; if the query matched the label only, fall
  // back to plain label (ranges target the value string).
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
      data-tooltip={hoverTitle || undefined}
      data-tooltip-pos="right"
      data-tooltip-wide=""
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onPick}
    >
      <span className="node-editor-template-suggestions__label">
        {labelSegments.map((segment, index) => (
          segment.highlight ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>
        ))}
        {item.detail ?? item.kind ? <em className="node-editor-template-suggestions__kind">{item.detail ?? item.kind}</em> : null}
      </span>
      <code>
        {valueSegments.map((segment, index) => (
          segment.highlight ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>
        ))}
      </code>
      {item.preview ? <small>{item.preview}</small> : null}
    </button>
  );
}

function getToken(value: string, cursor: number, mode: 'template' | 'path'): { start: number; query: string; active: boolean } {
  const before = value.slice(0, cursor);
  if (mode === 'template') {
    const start = before.lastIndexOf('{{');
    if (start < 0 || before.slice(start).includes('}}')) return { start: cursor, query: '', active: value.length === 0 };
    return { start, query: before.slice(start + 2).trim(), active: true };
  }

  const match = before.match(/[A-Za-z0-9_$.]*$/);
  const text = match?.[0] ?? '';
  return { start: cursor - text.length, query: text, active: true };
}
