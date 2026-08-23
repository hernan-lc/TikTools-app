import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { TemplateSuggestion } from './template-suggestions.ts';
import { AutocompletePortal } from './AutocompletePortal.tsx';

type TemplateFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: TemplateSuggestion[];
  suggestionMode?: 'template' | 'path';
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  ariaLabel?: string;
};

/**
 * Small, dependency-free template editor. It keeps the stored value as the
 * runtime expects (`{{ event.data.comment }}`) while letting users insert
 * valid paths instead of memorising the event shape.
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
}: TemplateFieldProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(value.length);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const updateCursor = (event: JSX.TargetedEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
  };

  const token = getToken(value, cursor, suggestionMode);
  const tokenQuery = token.query.toLowerCase();
  const visibleSuggestions = suggestions.filter((suggestion) => {
    if (!tokenQuery) return true;
    return suggestion.value.toLowerCase().includes(tokenQuery) || suggestion.label.toLowerCase().includes(tokenQuery);
  }).slice(0, 10);
  const showSuggestions = focused && token.active && visibleSuggestions.length > 0;

  useEffect(() => {
    setSuggestionIndex(0);
  }, [tokenQuery, suggestions.length]);

  const insertSuggestion = (suggestion: TemplateSuggestion): void => {
    const element = inputRef.current;
    const offset = element?.selectionStart ?? cursor;
    const token = getToken(value, offset, suggestionMode);
    const openToken = suggestionMode === 'template' && token.start < offset;
    const start = suggestionMode === 'path' || openToken ? token.start : offset;
    const inserted = suggestionMode === 'path' ? suggestion.value : `{{ ${suggestion.value} }}`;
    const nextValue = `${value.slice(0, start)}${inserted}${value.slice(offset)}`;
    const nextCursor = start + inserted.length;
    onValueChange(nextValue);
    setCursor(nextCursor);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleSuggestionKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (!showSuggestions || visibleSuggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSuggestionIndex((current) => (current + 1) % visibleSuggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSuggestionIndex((current) => (current - 1 + visibleSuggestions.length) % visibleSuggestions.length);
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      const selected = visibleSuggestions[suggestionIndex];
      if (selected) insertSuggestion(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setFocused(false);
    }
  };

  const control = multiline ? (
    <textarea
      ref={(element) => { inputRef.current = element; }}
      className="node-editor-template-control node-editor-template-control--textarea"
      value={value}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellcheck={false}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={handleSuggestionKeyDown}
      onInput={(event) => {
        onValueChange(event.currentTarget.value);
        updateCursor(event);
      }}
      onKeyUp={updateCursor}
      onSelect={updateCursor}
      onClick={updateCursor}
    />
  ) : (
    <input
      ref={(element) => { inputRef.current = element; }}
      className="node-editor-template-control"
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellcheck={false}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={handleSuggestionKeyDown}
      onInput={(event) => {
        onValueChange(event.currentTarget.value);
        updateCursor(event);
      }}
      onKeyUp={updateCursor}
      onSelect={updateCursor}
      onClick={updateCursor}
    />
  );

  return (
    <div ref={fieldRef} className="node-editor-template-field">
      <div className="node-editor-template-control-wrap">{control}</div>
      <AutocompletePortal anchorRef={fieldRef} cursorRef={inputRef} cursorOffset={cursor} open={showSuggestions}>
        <div className="node-editor-template-suggestions" role="listbox">
          {visibleSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.value}
              type="button"
              role="option"
              aria-selected={index === suggestionIndex}
              className={index === suggestionIndex ? 'is-selected' : ''}
              title={suggestion.preview ? `${suggestion.value} = ${suggestion.preview}` : suggestion.value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSuggestionIndex(index)}
              onClick={() => insertSuggestion(suggestion)}
            >
              <span>{suggestion.label}</span>
              <code>{suggestion.value}</code>
              {suggestion.preview ? <small>{suggestion.preview}</small> : null}
            </button>
          ))}
        </div>
      </AutocompletePortal>
    </div>
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
