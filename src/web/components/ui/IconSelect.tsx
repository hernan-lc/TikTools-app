import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export type IconSelectOption = {
  value: string;
  label: string;
  /** Drawn inside the closed control and beside the option. */
  icon?: ComponentChildren;
  /** Second line in the list: the code equivalent, a sample value… */
  meta?: string;
  hint?: string;
};

type IconSelectProps = {
  value: string;
  options: IconSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  /** Shown when the value matches no option (a hand-written path). */
  placeholder?: string;
};

/**
 * A select that can draw an icon. The native one cannot, which is why the
 * icon used to sit outside as a second element; here the closed control shows
 * the selected option exactly as the list does, so there is only one of it.
 */
export function IconSelect({ value, options, onChange, ariaLabel, className = '', placeholder }: IconSelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const openAt = (): void => {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };

  const commit = (index: number): void => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown')) {
      event.preventDefault();
      openAt();
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(active);
    }
  };

  return (
    <div className={`ui-select ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={`ui-select__control${open ? ' is-open' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openAt())}
        onKeyDown={onKeyDown}
      >
        {selected?.icon && <span className="ui-select__icon">{selected.icon}</span>}
        <span className="ui-select__value">{selected?.label ?? placeholder ?? ''}</span>
        <svg
          className="ui-select__caret"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="ui-select__menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`ui-select__option${option.value === value ? ' is-selected' : ''}${index === active ? ' is-active' : ''}`}
              title={option.hint}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(index)}
            >
              {option.icon && <span className="ui-select__icon">{option.icon}</span>}
              <span className="ui-select__text">
                <span className="ui-select__label">{option.label}</span>
                {option.meta && <span className="ui-select__meta">{option.meta}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
