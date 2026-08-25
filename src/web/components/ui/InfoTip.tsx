type InfoTipProps = {
  /** Shown on hover and focus, and read by screen readers. */
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
};

/**
 * The escape valve for a minimal form: the explanation lives behind an icon
 * instead of a paragraph under every field.
 */
export function InfoTip({ text, position = 'top' }: InfoTipProps) {
  return (
    <span
      className="ui-infotip"
      data-tooltip={text}
      data-tooltip-pos={position}
      data-tooltip-wide=""
      tabIndex={0}
      role="note"
      aria-label={text}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </svg>
    </span>
  );
}
