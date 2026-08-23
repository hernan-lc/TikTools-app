import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

export type TemplateSuggestion = {
  value: string;
  label: string;
};

type TemplateFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: TemplateSuggestion[];
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
  placeholder,
  multiline = false,
  rows = 4,
  ariaLabel,
}: TemplateFieldProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(value.length);

  const updateCursor = (event: JSX.TargetedEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
  };

  const tokenStart = value.slice(0, cursor).lastIndexOf('{{');
  const tokenQuery = tokenStart >= 0 && !value.slice(tokenStart, cursor).includes('}}')
    ? value.slice(tokenStart + 2, cursor).trim().toLowerCase()
    : '';
  const visibleSuggestions = suggestions.filter((suggestion) => {
    if (!tokenQuery) return true;
    return suggestion.value.toLowerCase().includes(tokenQuery) || suggestion.label.toLowerCase().includes(tokenQuery);
  }).slice(0, 10);
  const showSuggestions = focused && visibleSuggestions.length > 0;

  const insertSuggestion = (suggestion: TemplateSuggestion): void => {
    const element = inputRef.current;
    const offset = element?.selectionStart ?? cursor;
    const before = value.slice(0, offset);
    const tokenStart = before.lastIndexOf('{{');
    const openToken = tokenStart >= 0 && !before.slice(tokenStart).includes('}}');
    const start = openToken ? tokenStart : offset;
    const inserted = `{{ ${suggestion.value} }}`;
    const nextValue = `${value.slice(0, start)}${inserted}${value.slice(offset)}`;
    const nextCursor = start + inserted.length;
    onValueChange(nextValue);
    setCursor(nextCursor);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
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
      onInput={(event) => {
        onValueChange(event.currentTarget.value);
        updateCursor(event);
      }}
      onKeyUp={updateCursor}
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
      onInput={(event) => {
        onValueChange(event.currentTarget.value);
        updateCursor(event);
      }}
      onKeyUp={updateCursor}
      onClick={updateCursor}
    />
  );

  return (
    <div className="node-editor-template-field">
      <div className="node-editor-template-control-wrap">{control}</div>
      {showSuggestions ? (
        <div className="node-editor-template-suggestions" role="listbox">
          {visibleSuggestions.map((suggestion) => (
            <button
              key={suggestion.value}
              type="button"
              role="option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertSuggestion(suggestion)}
            >
              <span>{suggestion.label}</span>
              <code>{suggestion.value}</code>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
