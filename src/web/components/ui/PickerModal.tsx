import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

import { Modal } from './Modal.tsx';

export type PickerOption = {
  /** What gets stored in the filter. */
  value: string;
  label: string;
  /** Second line: the price of a gift, the points of a viewer… */
  meta?: ComponentChildren;
  imageUrl?: string;
  /** Drawn when there is no image (or it fails to load). */
  fallback?: ComponentChildren;
  /** Extra words the search should match — a gift id, a nickname. */
  keywords?: string;
};

export type PickerModalProps = {
  title: string;
  description?: string;
  options: PickerOption[];
  /** Values already chosen; they show as selected. */
  selected: string[];
  multiple?: boolean;
  searchPlaceholder: string;
  emptyLabel: string;
  /** Lets someone type a value the list does not have. */
  manualLabel?: string;
  manualPlaceholder?: string;
  /** Said when what is being typed already exists in the list. */
  alreadyLabel?: string;
  doneLabel: string;
  closeLabel: string;
  onPick: (values: string[]) => void;
  onClose: () => void;
};

/**
 * One searchable list of options with a picture per row — the gift picker and
 * the viewer picker are this component with a different source.
 */
export function PickerModal({
  title,
  description,
  options,
  selected,
  multiple = false,
  searchPlaceholder,
  emptyLabel,
  manualLabel,
  manualPlaceholder,
  alreadyLabel,
  doneLabel,
  closeLabel,
  onPick,
  onClose,
}: PickerModalProps) {
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  /** With nothing matching, what was searched is what would be typed. */
  const manualDraft = manual || (options.length > 0 ? query.trim() : '');
  const [chosen, setChosen] = useState<string[]>(selected);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(needle)
      || option.value.toLowerCase().includes(needle)
      || (option.keywords?.toLowerCase().includes(needle) ?? false));
  }, [options, query]);

  const toggle = (value: string): void => {
    if (!multiple) {
      onPick([value]);
      return;
    }
    setChosen((current) => current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]);
  };

  const manualValue = manualDraft.trim();
  /** What the list already calls this, so typing "rosa" picks "Rosa" instead of adding it twice. */
  const existing = options.find((option) => option.value.toLowerCase() === manualValue.toLowerCase()
    || option.label.toLowerCase() === manualValue.toLowerCase());

  const addManual = (): void => {
    if (!manualValue) return;
    const value = existing?.value ?? manualValue;
    setManual('');
    setQuery('');
    if (!multiple) {
      onPick([value]);
      return;
    }
    setChosen((current) => (current.includes(value) ? current : [...current, value]));
  };

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      closeLabel={closeLabel}
      className="ui-picker"
      footer={multiple
        ? (
          <div className="ui-modal-card__actions">
            <button type="button" className="plg-btn plg-btn--sm" onClick={onClose}>{closeLabel}</button>
            <button type="button" className="plg-btn plg-btn--primary plg-btn--sm" onClick={() => onPick(chosen)}>
              {doneLabel}
            </button>
          </div>
        )
        : undefined}
    >
      <div className="ui-picker__tools">
        <input
          className="plg-input"
          type="search"
          value={query}
          placeholder={searchPlaceholder}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div className="ui-picker__list">
        {visible.map((option) => {
          const active = multiple ? chosen.includes(option.value) : selected.includes(option.value);
          const showImage = option.imageUrl && !broken[option.value];
          return (
            <button
              type="button"
              key={option.value}
              className={`ui-picker__item${active ? ' is-active' : ''}`}
              onClick={() => toggle(option.value)}
            >
              <span className="ui-picker__thumb">
                {showImage
                  ? (
                    <img
                      src={option.imageUrl}
                      alt=""
                      loading="lazy"
                      onError={() => setBroken((current) => ({ ...current, [option.value]: true }))}
                    />
                  )
                  : option.fallback}
              </span>
              <span className="ui-picker__text">
                <span className="ui-picker__label">{option.label}</span>
                {option.meta && <span className="ui-picker__meta">{option.meta}</span>}
              </span>
              {active && <span className="ui-picker__check" aria-hidden="true">✓</span>}
            </button>
          );
        })}

        {visible.length === 0 && <p className="ui-picker__empty">{emptyLabel}</p>}
      </div>

      {/* Typing a name is the fallback, not the habit: it only shows up when the
          list has nothing to offer, or nothing matches what is being searched. */}
      {manualLabel && (options.length === 0 || (query.trim().length > 0 && visible.length === 0)) && (
        <div className="ui-picker__manual">
          <label className="plg-label">{manualLabel}</label>
          <div className="ui-picker__manual-row">
            <input
              className="plg-input"
              value={manualDraft}
              placeholder={manualPlaceholder}
              onInput={(event) => setManual((event.currentTarget as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addManual();
              }}
            />
            <button type="button" className="plg-btn plg-btn--sm" onClick={addManual} disabled={!manualValue}>
              +
            </button>
          </div>
          {existing && <span className="ui-picker__hint">{alreadyLabel ?? ''}</span>}
        </div>
      )}

      {multiple && chosen.length > 0 && (
        <div className="ui-picker__chosen">
          {chosen.map((value) => (
            <button
              type="button"
              className="plg-pill plg-pill--accent ui-picker__chip"
              key={value}
              onClick={() => setChosen((current) => current.filter((entry) => entry !== value))}
            >
              {options.find((option) => option.value === value)?.label ?? value}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
