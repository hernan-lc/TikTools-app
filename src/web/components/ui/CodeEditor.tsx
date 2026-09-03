import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { TemplateSuggestion } from '../node-editor/template-suggestions.ts';
import type { AutocompleteItem } from '../autocomplete/autocomplete.ts';
import { filterSuggestions, highlightSegments } from '../autocomplete/autocomplete.ts';
import { AutocompletePortal } from '../node-editor/AutocompletePortal.tsx';
import { t, type Locale } from '../../i18n.ts';

export type CodeEditorLanguage = 'json' | 'text';

type CodeEditorProps = {
  value: string;
  onValueChange: (value: string) => void;
  /** Variable suggestions for `{{ }}` autocomplete. */
  suggestions?: Array<TemplateSuggestion | AutocompleteItem>;
  language?: CodeEditorLanguage;
  locale?: Locale;
  /** File tab shown in the header, e.g. `payload.json`. */
  filename?: string;
  /** Mime shown in the header, e.g. `application/json`. */
  mime?: string;
  rows?: number;
  ariaLabel?: string;
  /** When set, a format button renders in the header. */
  onFormat?: () => void;
  formatLabel?: string;
};

/** Pretty-print JSON; `null` when the text is not valid JSON (button no-ops). */
export function formatJsonText(value: string): string | null {
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2);
  } catch {
    return null;
  }
}

/**
 * Small dependency-free code editor: gutter with line numbers, a highlighted
 * backdrop (JSON tokens + `{{ }}` pills) behind a transparent textarea, and
 * the same quiet variable autocomplete as the single-line template inputs.
 */
export function CodeEditor({
  value,
  onValueChange,
  suggestions = [],
  language = 'text',
  locale = 'en',
  filename,
  mime,
  rows = 7,
  ariaLabel,
  onFormat,
  formatLabel,
}: CodeEditorProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLPreElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [forcedOpen, setForcedOpen] = useState(false);
  const [cursor, setCursor] = useState(value.length);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const lineCount = useMemo(() => Math.max(1, value.split('\n').length), [value]);
  const lineHeight = 19.2; // 12px mono * 1.6
  const visibleLines = Math.max(lineCount, rows);
  const minEditHeight = visibleLines * lineHeight + 20;
  const nodes = useMemo(
    () => (language === 'json' ? highlightJson(value) : highlightText(value)),
    [value, language],
  );

  const token = getToken(value, cursor);
  const items = useMemo(() => dedupeItems(suggestions.map(toItem)), [suggestions]);
  const scored = useMemo(() => filterSuggestions(items, token.query, 7), [items, token.query]);
  const visible = scored.map((entry) => ({ item: entry.item, ranges: entry.matchRanges }));
  const showSuggestions = focused && (forcedOpen || token.inside || token.query.length >= 2) && visible.length > 0;

  useEffect(() => {
    setSuggestionIndex(0);
  }, [token.query, suggestions.length]);

  useEffect(() => {
    if (!showSuggestions) setForcedOpen(false);
  }, [showSuggestions]);

  const syncScroll = (): void => {
    const target = inputRef.current;
    if (!target) return;
    if (gutterRef.current) gutterRef.current.scrollTop = target.scrollTop;
    if (backdropRef.current) {
      backdropRef.current.scrollTop = target.scrollTop;
      backdropRef.current.scrollLeft = target.scrollLeft;
    }
  };

  const updateCursor = (): void => {
    const target = inputRef.current;
    setCursor(target?.selectionStart ?? value.length);
  };

  const insertSuggestion = (suggestion: { value: string }): void => {
    const offset = inputRef.current?.selectionStart ?? cursor;
    const current = getToken(value, offset);
    // Replace the exact word/`{{ …` span being typed; inserting at the
    // cursor without replacing duplicated the typed text.
    const start = current.inside || current.query.length > 0 ? current.start : offset;
    const inserted = `{{ ${suggestion.value} }}`;
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

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
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
    } else if (event.key === 'Tab' || (event.key === 'Enter' && (token.inside || forcedOpen))) {
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

  const showHead = Boolean(filename || mime || onFormat);

  return (
    <div ref={boxRef} className="codeed">
      {showHead && (
        <div className="codeed-head">
          <span className="codeed-file">
            {filename && (
              <>
                <i className="codeed-dot" aria-hidden="true" />
                {filename}
              </>
            )}
          </span>
          <span className="codeed-side">
            {mime && <span className="codeed-mime">{mime}</span>}
            {onFormat && (
              <button type="button" className="codeed-format" onClick={onFormat}>
                {formatLabel ?? t(locale, 'behavior.editor.format')}
              </button>
            )}
          </span>
        </div>
      )}
      <div className="codeed-body">
        <div ref={gutterRef} className="codeed-gutter" aria-hidden="true">
          {Array.from({ length: visibleLines }, (_, index) => (
            <span key={index + 1}>{index + 1}</span>
          ))}
        </div>
        <div className="codeed-edit" style={{ minHeight: `${minEditHeight}px` }}>
          <pre ref={backdropRef} className="codeed-backdrop" aria-hidden="true">
            <code>
              {nodes}
              {value.endsWith('\n') ? '\n​' : ''}
            </code>
          </pre>
          <textarea
            ref={inputRef}
            className="codeed-input"
            value={value}
            rows={rows}
            spellcheck={false}
            wrap="off"
            aria-label={ariaLabel}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              setForcedOpen(false);
            }}
            onKeyDown={handleKeyDown}
            onInput={(event) => {
              onValueChange(event.currentTarget.value);
              updateCursor();
            }}
            onKeyUp={updateCursor}
            onSelect={updateCursor}
            onClick={updateCursor}
            onScroll={syncScroll}
          />
        </div>
      </div>
      <AutocompletePortal anchorRef={boxRef} cursorRef={inputRef} cursorOffset={cursor} open={showSuggestions}>
        <div className="tpl-suggest" role="listbox" aria-label={ariaLabel ?? 'Suggestions'}>
          {visible.map(({ item, ranges }, index) => {
            const valueSegments = highlightSegments(item.value, ranges);
            const hoverTitle = [
              item.value,
              item.detail ?? item.kind ? `type: ${item.detail ?? item.kind}` : '',
              item.preview ? `= ${item.preview}` : '',
              item.documentation ?? '',
            ].filter(Boolean).join('\n');
            return (
              <button
                key={`${item.value}:${index}`}
                type="button"
                role="option"
                aria-selected={index === suggestionIndex}
                className={index === suggestionIndex ? 'is-selected' : ''}
                title={hoverTitle || item.value}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSuggestionIndex(index)}
                onFocus={() => setSuggestionIndex(index)}
                onClick={() => insertSuggestion(item)}
              >
                <i className={`tpl-dot tpl-dot--${item.kind ?? 'unknown'}`} aria-hidden="true" />
                <code className="tpl-path">
                  {valueSegments.map((segment, segmentIndex) => (
                    segment.highlight ? <mark key={segmentIndex}>{segment.text}</mark> : <span key={segmentIndex}>{segment.text}</span>
                  ))}
                </code>
                {item.detail ?? item.kind ? <span className="tpl-kind">{item.detail ?? item.kind}</span> : null}
                {item.preview ? <span className="tpl-preview" title={item.preview}>{item.preview}</span> : null}
              </button>
            );
          })}
          <div className="tpl-foot">{t(locale, 'autocompleteNavigateInsert')}</div>
        </div>
      </AutocompletePortal>
    </div>
  );
}

function toItem(suggestion: TemplateSuggestion | AutocompleteItem): AutocompleteItem & { label: string; value: string } {
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

function getToken(value: string, cursor: number): { start: number; query: string; inside: boolean } {
  const before = value.slice(0, cursor);
  const start = before.lastIndexOf('{{');
  if (start >= 0 && !before.slice(start).includes('}}')) {
    return { start, query: before.slice(start + 2).trim(), inside: true };
  }
  const match = before.match(/[A-Za-z0-9_$.]*$/);
  const word = match?.[0] ?? '';
  return { start: cursor - word.length, query: word, inside: false };
}

/** Plain text: only `{{ }}` spans get the pill treatment. */
function highlightText(value: string): JSX.Element[] {
  if (!value) return [<span key="empty">{''}</span>];
  const parts = value.split(/(\{\{\s*[^{}]*\}?\}?)/g);
  return parts.map((part, index) =>
    index % 2 === 1 ? <span key={index} className="codeed-var">{part || '{{'}</span> : <span key={index}>{part}</span>,
  );
}

type JsonToken = { text: string; cls: string };

/** Fault-tolerant JSON highlighter: broken input while typing still renders. */
export function tokenizeJson(chunk: string): JsonToken[] {
  const out: JsonToken[] = [];
  const pattern = /(\s+)|("(?:[^"\\]|\\.)*"?)|(-?\d[\d._]*)|\b(true|false|null)\b|([{}[\],:])|(.)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(chunk)) !== null) {
    const [full, ws, str, num, lit, punct] = match;
    if (ws) {
      out.push({ text: full, cls: 'codeed-ws' });
      continue;
    }
    if (str) {
      const rest = chunk.slice(match.index + full.length);
      out.push({ text: full, cls: /^\s*:/.test(rest) ? 'codeed-key' : 'codeed-str' });
      continue;
    }
    if (num) {
      out.push({ text: num, cls: 'codeed-num' });
      continue;
    }
    if (lit) {
      out.push({ text: lit, cls: 'codeed-lit' });
      continue;
    }
    if (punct) {
      out.push({ text: punct, cls: 'codeed-punct' });
      continue;
    }
    out.push({ text: full, cls: 'codeed-plain' });
  }
  return out;
}

function highlightJson(value: string): JSX.Element[] {
  if (!value) return [<span key="empty">{''}</span>];
  const out: JSX.Element[] = [];
  const varPattern = /\{\{\s*[^{}]*\}?\}?/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  const pushChunk = (chunk: string): void => {
    for (const token of tokenizeJson(chunk)) out.push(<span key={key++} className={token.cls}>{token.text}</span>);
  };
  while ((match = varPattern.exec(value)) !== null) {
    if (match.index > last) pushChunk(value.slice(last, match.index));
    out.push(<span key={key++} className="codeed-var">{match[0]}</span>);
    last = match.index + match[0].length;
  }
  if (last < value.length) pushChunk(value.slice(last));
  return out;
}
